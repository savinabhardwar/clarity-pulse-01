// Snapshots each person's engineering-ethos leaderboard scores (pace,
// estimate accuracy, Jira hygiene/estimate coverage, overall, and
// whether they qualified for ranking) the first time a sprint is found
// closed, into person_sprint_summaries (see 0032 migration for the full
// design rationale and known limitations). Mirrors the exact scoring
// rules in engineering-ethos/src/lib/eng-data.ts:
//   - computeSprintHours: pro-rated allocated hours (remaining estimate,
//     falling back to original), sprint-window-scoped logged hours,
//     tickets over OVERSIZED_TICKET_SECONDS excluded from both.
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
const SPRINT_DAILY_HOURS = 7;

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

function computeForPerson({ personId, tickets, worklogs, comments, sprintStart, sprintEnd }) {
  const owned = tickets.filter((t) => t.assignee_person_id === personId);
  const sized = owned.filter((t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS);
  const sizedIds = new Set(sized.map((t) => t.id));

  const allocatedHours =
    sized.reduce((s, t) => s + (t.remaining_estimate_seconds ?? t.original_estimate_seconds ?? 0), 0) / 3600;
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

  // Same pace-denominator floor as toEmployee/paceDenominatorFloor in
  // eng-data.ts -- a thin remaining-estimate pool (most tickets already
  // burned down to 0h) shouldn't let a small amount of logged work spike
  // the ratio. For a closed sprint the floor uses its FULL workday
  // count (the whole sprint has elapsed by the time this runs), not a
  // partial day count the way the live app does mid-sprint.
  const totalWorkdays = workdaysBetween(sprintStart, sprintEnd) + 1;
  const paceDenominator = Math.max(allocatedHours, SPRINT_DAILY_HOURS * totalWorkdays, 1);
  const paceScore = hasOpenWork ? Math.min(100, Math.round((loggedHours / paceDenominator) * 100)) : null;

  const estimateCoverage =
    owned.length > 0
      ? Math.round((100 * owned.filter((t) => t.original_estimate_seconds !== null).length) / owned.length)
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
  // from worklogs dated inside it.
  const doneInWindow = owned.filter(
    (t) => t.status_category === "done" && t.resolved_at && t.resolved_at >= sprintStart && t.resolved_at <= sprintEnd,
  );
  let estSeconds = 0;
  let spentSeconds = 0;
  for (const t of doneInWindow) {
    const est = t.original_estimate_seconds ?? 0;
    const spent = worklogs
      .filter((w) => w.ticket_id === t.id && w.started_at >= sprintStart && w.started_at <= sprintEnd)
      .reduce((s, w) => s + w.seconds, 0);
    if (est <= 0 || est > OVERSIZED_TICKET_SECONDS || spent <= 0 || spent > est) continue;
    estSeconds += est;
    spentSeconds += spent;
  }
  const estimateScore = estSeconds > 0 ? Math.round((spentSeconds / estSeconds) * 100) : null;

  // Pace counts as a real 0 when null (mirrors computeOverallScore in
  // eng-data.ts) -- "nothing to measure pace against" is exactly the
  // failure this is meant to catch, not a free pass. Estimate accuracy/
  // hygiene/logging stay excluded when null since "haven't finished a
  // ticket" or "no in-progress ticket" legitimately can be blameless.
  const paceTerm = paceScore ?? 0;
  const otherTerms = [estimateScore, estimateCoverage, loggingScore].filter((s) => s !== null);
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
    hygieneScore: estimateCoverage,
    loggingScore,
    overallScore,
    allocatedHours: Math.round(allocatedHours * 10) / 10,
    loggedHours: Math.round(loggedHours * 10) / 10,
    jiraQualifies,
    jiraStatusTag,
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
        `select id, assignee_person_id, epic_id, status_category, original_estimate_seconds, remaining_estimate_seconds,
                time_spent_seconds, resolved_at, updated_at, created_at
         from tickets
         where sprint_id in (select id from sprints where start_date = $1)`,
        [sprintStart],
      );
      const { rows: worklogs } = await pool.query(
        `select w.ticket_id, w.author_person_id, w.started_at, w.seconds
         from worklogs w
         where w.started_at >= $1 and w.started_at <= $2`,
        [sprintStart, sprintEnd],
      );
      const { rows: comments } = await pool.query(
        `select tc.ticket_id, tc.author_person_id, tc.created_at from ticket_comments tc`,
      );

      const summaryRows = people.map((p) => {
        const s = computeForPerson({
          personId: p.id,
          tickets,
          worklogs,
          comments,
          sprintStart,
          sprintEnd,
        });
        return { personId: p.id, ...s };
      });

      for (const s of summaryRows) {
        await pool.query(
          `insert into person_sprint_summaries
             (person_id, sprint_start, sprint_end, pace_score, estimate_score, hygiene_score,
              logging_score, overall_score, allocated_hours, logged_hours, jira_qualifies, jira_status_tag)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
