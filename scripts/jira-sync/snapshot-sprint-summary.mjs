// Snapshots each person's engineering-ethos leaderboard scores (pace,
// estimate accuracy, Jira hygiene/estimate coverage, overall, and
// whether they qualified for ranking) the first time a sprint is found
// closed, into person_sprint_summaries (see 0032 migration for the full
// design rationale and known limitations). Mirrors the exact scoring
// rules in engineering-ethos/src/lib/eng-data.ts:
//   - computeSprintHours: allocated hours are the full original estimate,
//     pro-rated only for spillover tickets by subtracting hours logged
//     BEFORE this sprint started (any earlier sprint), not Jira's own
//     remaining_estimate_seconds -- that field can be, and in practice
//     has been, manually overridden independent of actual logging.
//     Hours logged DURING this sprint never reduce the figure.
//     Sprint-window-scoped logged hours, tickets over
//     OVERSIZED_TICKET_SECONDS excluded from both.
//   - computeSprintEstimateAccuracy: judged only on tickets resolved
//     inside the sprint window, spent time from worklogs dated inside it.
//   - computeJiraUpdateStatus: qualifies only with zero silently-pending
//     in-progress tickets and a recent worklog/comment; "recent" here is
//     evaluated against the sprint's OWN end date, not today, since this
//     is a retrospective judgment of how that sprint ended, not of today.
// Run as a step in run-full-sync.mjs -- idempotent, only ever inserts,
// never updates an existing snapshot (see the unique constraint).
import pg from "pg";
import { pathToFileURL } from "node:url";
import { workdaysBetween } from "./lib/workdays.mjs";

const OVERSIZED_TICKET_SECONDS = 35 * 3600; // 5 workdays at this org's 7h/day sprint policy

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

// Gated on EITHER table missing a row for this sprint, not just
// person_sprint_summaries -- a sprint already person-snapshotted (e.g.
// from before project_sprint_summaries existed) must still come back
// through here until its project-level rows exist too, otherwise the
// project snapshot silently never runs and, once purge-closed-sprint-
// tickets.mjs deletes the underlying tickets, can never be computed at
// all. Both inserts below are idempotent (on conflict do nothing), so
// re-running person-snapshotting for an already-snapshotted sprint here
// is a harmless no-op.
async function findUnsnapshottedClosedSprints(pool) {
  const { rows } = await pool.query(`
    select s.start_date, max(s.end_date) as end_date
    from sprints s
    where s.end_date < now()
    group by s.start_date
    having not exists (
      select 1 from person_sprint_summaries pss where pss.sprint_start = s.start_date
    ) or not exists (
      select 1 from project_sprint_summaries pjs where pjs.sprint_start = s.start_date
    )
    order by s.start_date
  `);
  return rows.map((r) => ({ start: toDate(r.start_date), end: toDate(r.end_date) }));
}

// Per-ticket Jira Hygiene check -- mirrors ticketHygieneGaps in
// eng-data.ts exactly (see that function's comment for the full
// rationale). Duplicated here rather than imported since this repo and
// engineering-ethos are separate deploy targets with no shared package.
function ticketHygieneGaps(t) {
  const gaps = [];
  if (!t.hasEstimate) gaps.push("no original estimate");
  if (t.isOversized) gaps.push("estimate over 35h (needs breakdown)");
  if (!t.hasEpic) gaps.push("no epic");
  if (!t.isToDo && !t.hasComment) gaps.push("no comment");
  if (!t.isToDo && !t.isBlocked && !t.hasWorklog) gaps.push("no worklog");
  return gaps;
}

function computeForPerson({ personId, tickets, worklogs, allWorklogsForTickets, comments, sprintStart, sprintEnd, nameBySprintId }) {
  const owned = tickets.filter((t) => t.assignee_person_id === personId);
  // The board this person's own work actually lived on for this closed
  // sprint -- multiple boards close sprints on different, unaligned
  // dates (see 0047 migration), so "the sprint" isn't a single global
  // concept; it's whichever board's sprint this person was actually
  // assigned to. Undefined when they had nothing assigned at all, in
  // which case the caller skips inserting a row entirely.
  const sprintName = owned.length > 0 ? (nameBySprintId.get(owned[0].sprint_id) ?? null) : null;
  // allocatedHours/loggedHours count BOTH open and done tickets this
  // sprint -- hours logged on something finished are still real work
  // done this sprint. A done ticket contributes its ORIGINAL estimate
  // (not remaining, which is trivially ~0 once finished -- pro-rata only
  // makes sense for work still in flight) so the denominator reflects
  // "this much work was committed to the sprint," not zero just because
  // it's done. Blocked tickets are excluded outright -- not actionable
  // regardless of effort, so they shouldn't count as capacity someone is
  // failing to use. Mirrors computeSprintHours in eng-data.ts.
  const sized = owned.filter((t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS && !t.is_blocked);
  const sizedIds = new Set(sized.map((t) => t.id));
  const doneIds = new Set(owned.filter((t) => t.status_category === "done").map((t) => t.id));

  // A ticket carried over from a prior sprint has already had some of
  // its original estimate burned down there -- allocatedHours for THIS
  // sprint should reflect only what's still outstanding, computed
  // ourselves as original minus whatever was logged BEFORE this sprint
  // started (any earlier sprint, any author), rather than trusting
  // Jira's own remaining_estimate_seconds directly (observed to drift
  // from that computation in practice, via manual overrides). Hours
  // logged DURING this sprint never reduce this figure -- it's a fixed
  // "committed to this sprint" total, not something that shrinks as the
  // sprint progresses. Mirrors computeSprintHours in eng-data.ts.
  const totalLoggedByTicket = new Map();
  for (const w of allWorklogsForTickets) {
    totalLoggedByTicket.set(w.ticket_id, (totalLoggedByTicket.get(w.ticket_id) ?? 0) + w.seconds);
  }
  const loggedThisSprintByTicket = new Map();
  for (const w of worklogs) {
    loggedThisSprintByTicket.set(w.ticket_id, (loggedThisSprintByTicket.get(w.ticket_id) ?? 0) + w.seconds);
  }
  const allocatedHours =
    sized.reduce((s, t) => {
      const original = t.original_estimate_seconds ?? 0;
      if (doneIds.has(t.id)) return s + original;
      const loggedAllTime = totalLoggedByTicket.get(t.id) ?? 0;
      const loggedThisSprint = loggedThisSprintByTicket.get(t.id) ?? 0;
      const loggedBeforeSprint = Math.max(loggedAllTime - loggedThisSprint, 0);
      return s + Math.max(original - loggedBeforeSprint, 0);
    }, 0) / 3600;
  const loggedSeconds = worklogs
    .filter(
      (w) =>
        w.author_person_id === personId &&
        sizedIds.has(w.ticket_id) &&
        w.started_at >= sprintStart &&
        w.started_at <= sprintEnd,
    )
    .reduce((s, w) => s + w.seconds, 0);
  const loggedHours = loggedSeconds / 3600;
  const hasOpenWork = sized.length > 0;

  // Same pace formula as computePaceScore in eng-data.ts: logged hours
  // vs a pro-rated expectation for how far into the sprint "now" is,
  // not the full allocation outright. For a CLOSED sprint the whole
  // thing has already elapsed by the time this runs, so dayNumber ===
  // totalDays and the expectation collapses to the full allocatedHours
  // -- i.e. plain loggedHours/allocatedHours, floored at 1h to avoid
  // dividing by zero on an empty allocation.
  const paceDenominator = Math.max(allocatedHours, 1);
  const paceScore = hasOpenWork ? Math.min(100, Math.round((loggedHours / paceDenominator) * 100)) : null;

  // Jira Hygiene: multi-criteria check via ticketHygieneGaps, across
  // every ticket owned this sprint (open AND done -- `tickets` here was
  // never filtered by status_category, unlike the live app's
  // useOpenTickets, so done tickets are already included). hasWorklog is
  // "ever" (allWorklogsForTickets, unscoped by date), matching
  // get_person_detail's semantics -- not the sprint-window-scoped
  // `worklogs` used for pace/logging discipline above.
  const ticketsWithWorklogEver = new Set(allWorklogsForTickets.map((w) => w.ticket_id));
  const ticketsWithCommentEver = new Set(comments.map((c) => c.ticket_id));
  const hygieneScore =
    owned.length > 0
      ? Math.round(
          (100 *
            owned.filter(
              (t) =>
                ticketHygieneGaps({
                  hasEstimate: t.original_estimate_seconds !== null,
                  isOversized: (t.original_estimate_seconds ?? 0) > OVERSIZED_TICKET_SECONDS,
                  hasEpic: t.epic_id !== null,
                  hasComment: ticketsWithCommentEver.has(t.id),
                  hasWorklog: ticketsWithWorklogEver.has(t.id),
                  isToDo: t.status_category === "new" && !t.is_blocked,
                  isBlocked: t.is_blocked,
                }).length === 0,
            ).length) /
            owned.length,
        )
      : null;

  // Logging discipline: of the tickets they were actively working
  // (in-progress) during this sprint, what fraction have a worklog
  // logged inside the sprint window -- mirrors computeSprintHours'
  // loggingScore in eng-data.ts.
  const wipTickets = owned.filter((t) => t.status_category === "indeterminate");
  const ticketsLoggedByPersonInWindow = new Set(
    worklogs
      .filter((w) => w.author_person_id === personId && w.started_at >= sprintStart && w.started_at <= sprintEnd)
      .map((w) => w.ticket_id),
  );
  const loggingScore =
    wipTickets.length > 0
      ? Math.round((100 * wipTickets.filter((t) => ticketsLoggedByPersonInWindow.has(t.id)).length) / wipTickets.length)
      : null;

  // Estimate accuracy: tickets resolved inside this window, spent time
  // from worklogs dated inside it. Mirrors computeSprintEstimateAccuracy
  // in eng-data.ts -- per ticket, accuracy is min(spent,est)/max(spent,est)
  // (symmetric, so an overrun pulls the score down instead of being
  // silently excluded), pooled across tickets weighted by size.
  const doneInWindow = owned.filter(
    (t) => t.status_category === "done" && t.resolved_at && t.resolved_at >= sprintStart && t.resolved_at <= sprintEnd,
  );
  let matchedSeconds = 0;
  let totalSeconds = 0;
  for (const t of doneInWindow) {
    const est = t.original_estimate_seconds ?? 0;
    const spent = worklogs
      .filter((w) => w.ticket_id === t.id && w.started_at >= sprintStart && w.started_at <= sprintEnd)
      .reduce((s, w) => s + w.seconds, 0);
    if (est <= 0 || est > OVERSIZED_TICKET_SECONDS || spent <= 0) continue;
    matchedSeconds += Math.min(spent, est);
    totalSeconds += Math.max(spent, est);
  }
  const estimateScore = totalSeconds > 0 ? Math.round((matchedSeconds / totalSeconds) * 100) : null;

  // Pace counts as a real 0 when null (mirrors computeOverallScore in
  // eng-data.ts) -- "nothing to measure pace against" is exactly the
  // failure this is meant to catch, not a free pass. Estimate accuracy/
  // hygiene/logging stay excluded when null since "haven't finished a
  // ticket" or "no in-progress ticket" legitimately can be blameless.
  const paceTerm = paceScore ?? 0;
  const otherTerms = [estimateScore, hygieneScore, loggingScore].filter((s) => s !== null);
  const terms = [paceTerm, ...otherTerms];
  const rawOverallScore = Math.round(terms.reduce((a, b) => a + b, 0) / terms.length);

  // Jira update status, judged as of the sprint's own end date -- did
  // this person leave any in-progress ticket completely untouched, and
  // when was their last worklog/comment relative to when the sprint
  // actually ended.
  let jiraQualifies = false;
  let jiraStatusTag = null;
  if (owned.length === 0) {
    jiraStatusTag = "Nothing assigned this sprint";
  } else {
    const wip = owned.filter((t) => t.status_category === "indeterminate");
    const ticketsWithWorklog = new Set(worklogs.map((w) => w.ticket_id));
    const ticketsWithComment = new Set(comments.map((c) => c.ticket_id));
    const pending = wip.filter((t) => !ticketsWithWorklog.has(t.id) && !ticketsWithComment.has(t.id));
    if (pending.length > 0) {
      const maxDays = Math.max(...pending.map((t) => workdaysBetween(toDate(t.updated_at), sprintEnd)));
      jiraStatusTag = `Pending updates on ${pending.length} ticket${pending.length === 1 ? "" : "s"} (${maxDays} working day${maxDays === 1 ? "" : "s"} since last touched)`;
    } else {
      let lastActivity = null;
      for (const w of worklogs) {
        if (w.author_person_id !== personId) continue;
        if (!lastActivity || w.started_at > lastActivity) lastActivity = w.started_at;
      }
      for (const c of comments) {
        if (c.author_person_id !== personId) continue;
        if (!lastActivity || c.created_at > lastActivity) lastActivity = c.created_at;
      }
      const idleWorkdays = lastActivity ? workdaysBetween(lastActivity, sprintEnd) : null;
      if (idleWorkdays === null) jiraStatusTag = "No Jira updates";
      else if (idleWorkdays > 1) jiraStatusTag = `No Jira updates in ${idleWorkdays} working days`;
      else jiraQualifies = true;
    }
  }

  // Not-updating-Jira docks the Overall score itself (mirrors
  // applyJiraUpdatePenalty in eng-data.ts) -- not just the ranking
  // position -- since a decent pace/estimate/hygiene average shouldn't
  // still read as high for someone who wasn't trustworthy on this
  // sprint's own data.
  const overallScore = jiraQualifies ? rawOverallScore : Math.round(rawOverallScore * 0.5);

  return {
    paceScore,
    estimateScore,
    hygieneScore,
    loggingScore,
    overallScore,
    allocatedHours: Math.round(allocatedHours * 10) / 10,
    loggedHours: Math.round(loggedHours * 10) / 10,
    jiraQualifies,
    jiraStatusTag,
    sprintName,
  };
}

// Project-level counterpart to computeForPerson -- one row per project
// that had tickets in this sprint, so purge-closed-sprint-tickets.mjs has
// somewhere durable to preserve project history before deleting the
// underlying ticket rows. A ticket created before the sprint started
// counts as spillover into it (carried-over work), mirroring the same
// "was this already in flight before this sprint" signal the person-level
// pace/allocated-hours math uses remaining_estimate_seconds for.
function computeForProject({ tickets, sprintStart, sprintEnd }) {
  const sized = tickets.filter((t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS);
  const hoursEstimated = sized.reduce((s, t) => s + (t.original_estimate_seconds ?? 0), 0) / 3600;
  const hoursLogged = sized.reduce((s, t) => s + (t.time_spent_seconds ?? 0), 0) / 3600;
  const ticketsCompleted = tickets.filter(
    (t) => t.status_category === "done" && t.resolved_at && t.resolved_at >= sprintStart && t.resolved_at <= sprintEnd,
  ).length;
  const spilloverTickets = tickets.filter((t) => t.created_at && t.created_at < sprintStart).length;
  return {
    ticketsTotal: tickets.length,
    ticketsCompleted,
    hoursEstimated: Math.round(hoursEstimated * 10) / 10,
    hoursLogged: Math.round(hoursLogged * 10) / 10,
    spilloverTickets,
  };
}

export async function snapshotClosedSprints(databaseUrl) {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  let totalInserted = 0;
  try {
    const closedSprints = await findUnsnapshottedClosedSprints(pool);
    if (closedSprints.length === 0) {
      console.log("[snapshot-sprint-summary] no newly-closed sprints to snapshot");
      return { sprintsSnapshotted: 0, rowsInserted: 0, projectRowsInserted: 0 };
    }

    const { rows: people } = await pool.query(`select id from people where active and not excluded`);
    let totalProjectRowsInserted = 0;

    for (const sprint of closedSprints) {
      const sprintStart = sprint.start;
      const sprintEnd = sprint.end;

      const { rows: tickets } = await pool.query(
        `select id, assignee_person_id, epic_id, status_category, is_blocked, original_estimate_seconds, remaining_estimate_seconds,
                time_spent_seconds, resolved_at, updated_at, created_at, sprint_id
         from tickets
         where sprint_id in (select id from sprints where start_date = $1)`,
        [sprintStart],
      );
      // Which literal board/sprint each person's tickets actually sat
      // in, for sprintName -- see computeForPerson.
      const { rows: sprintRowsForGroup } = await pool.query(`select id, name from sprints where start_date = $1`, [sprintStart]);
      const nameBySprintId = new Map(sprintRowsForGroup.map((r) => [r.id, r.name]));
      const { rows: worklogs } = await pool.query(
        `select w.ticket_id, w.author_person_id, w.started_at, w.seconds
         from worklogs w
         where w.started_at >= $1 and w.started_at <= $2`,
        [sprintStart, sprintEnd],
      );
      // Unscoped by date -- used both for hygiene's hasWorklog check
      // ("was this ticket ever logged against", not "logged against
      // within this sprint's window" -- that's what the sprint-scoped
      // `worklogs` above is for) and for allocatedHours' pro-rata
      // (original estimate minus ALL-TIME logged, so seconds is needed
      // here too).
      const { rows: allWorklogsForTickets } = await pool.query(
        `select w.ticket_id, w.seconds from worklogs w
         join tickets tk on tk.id = w.ticket_id
         where tk.sprint_id in (select id from sprints where start_date = $1)`,
        [sprintStart],
      );
      const { rows: comments } = await pool.query(
        `select tc.ticket_id, tc.author_person_id, tc.created_at from ticket_comments tc`,
      );

      const summaryRows = people
        .map((p) => {
          const s = computeForPerson({
            personId: p.id,
            tickets,
            worklogs,
            allWorklogsForTickets,
            comments,
            sprintStart,
            sprintEnd,
            nameBySprintId,
          });
          return { personId: p.id, ...s };
        })
        // Every closed sprint on every board used to get snapshotted for
        // EVERY person, regardless of whether they had anything to do
        // with that board -- producing a "Nothing assigned this sprint"
        // row for each unrelated board's sprint that happened to close
        // around the same time. That's pure noise (see 0047 migration),
        // so it's never inserted going forward.
        .filter((s) => s.jiraStatusTag !== "Nothing assigned this sprint");

      for (const s of summaryRows) {
        await pool.query(
          `insert into person_sprint_summaries
             (person_id, sprint_start, sprint_end, pace_score, estimate_score, hygiene_score,
              logging_score, overall_score, allocated_hours, logged_hours, jira_qualifies, jira_status_tag, sprint_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (person_id, sprint_start) do nothing`,
          [
            s.personId,
            sprintStart,
            sprintEnd,
            s.paceScore,
            s.estimateScore,
            s.hygieneScore,
            s.loggingScore,
            s.overallScore,
            s.allocatedHours,
            s.loggedHours,
            s.jiraQualifies,
            s.jiraStatusTag,
            s.sprintName,
          ],
        );
        totalInserted++;
      }
      console.log(
        `[snapshot-sprint-summary] snapshotted sprint starting ${sprintStart.toISOString()} -- ${summaryRows.length} people`,
      );

      // Project-level: group this sprint's tickets by conceptual project
      // (via epic -> epics.project_id), same grouping the rest of the app
      // already uses for project_contributors/project_updates.
      const { rows: epicRows } = await pool.query(`select id, project_id from epics where project_id is not null`);
      const projectIdByEpicId = new Map(epicRows.map((r) => [r.id, r.project_id]));
      const ticketsByProject = new Map();
      for (const t of tickets) {
        const projectId = t.epic_id ? projectIdByEpicId.get(t.epic_id) : null;
        if (!projectId) continue;
        if (!ticketsByProject.has(projectId)) ticketsByProject.set(projectId, []);
        ticketsByProject.get(projectId).push(t);
      }
      for (const [projectId, projectTickets] of ticketsByProject) {
        const s = computeForProject({ tickets: projectTickets, sprintStart, sprintEnd });
        await pool.query(
          `insert into project_sprint_summaries
             (project_id, sprint_start, sprint_end, tickets_total, tickets_completed, hours_estimated, hours_logged, spillover_tickets)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (project_id, sprint_start) do nothing`,
          [projectId, sprintStart, sprintEnd, s.ticketsTotal, s.ticketsCompleted, s.hoursEstimated, s.hoursLogged, s.spilloverTickets],
        );
        totalProjectRowsInserted++;
      }
      console.log(
        `[snapshot-sprint-summary] snapshotted sprint starting ${sprintStart.toISOString()} -- ${ticketsByProject.size} project(s)`,
      );
    }
    return { sprintsSnapshotted: closedSprints.length, rowsInserted: totalInserted, projectRowsInserted: totalProjectRowsInserted };
  } finally {
    await pool.end();
  }
}

// pathToFileURL (not a plain "file://" + path template) so this works
// on Windows too, where process.argv[1] is a backslash-separated path,
// not a URL.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await snapshotClosedSprints(databaseUrl);
  console.log("[snapshot-sprint-summary] done:", result);
}
