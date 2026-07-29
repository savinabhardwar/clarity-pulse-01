import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { makePool, upsert, insertMany, replaceComputed } from "./lib/db.mjs";
import { computeMetrics } from "./lib/metrics.mjs";
import { clusterTicketTitles } from "./lib/dedup-titles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = (f) => path.join(__dirname, "cache", f);
const GENERATED = (f) => path.join(__dirname, "..", "..", "src", "data", "generated", f);

// Business-readable stand-in for an LLM summary: the cluster's distinct
// ticket titles already read like a changelog, so bullet them directly
// rather than showing "Spans N epic(s), M ticket(s)" plus a wall of raw
// ticket-key chips.
function summarizeCluster(cluster) {
  const distinctSummaries = [...new Set(cluster.tickets.map((t) => t.summary.trim()))];
  const MAX_BULLETS = 3;
  const bullets = distinctSummaries.slice(0, MAX_BULLETS).map((s) => `• ${s}`);
  if (distinctSummaries.length > MAX_BULLETS) {
    bullets.push(`• +${distinctSummaries.length - MAX_BULLETS} more`);
  }
  return bullets.join("\n");
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const JIRA_PROJECTS = [
  { key: "TEAM", name: "Team-PixelBlinders" },
  { key: "TI", name: "Team - Infrastructure" },
  { key: "TEAMSANKYA", name: "Team Sankya" },
  { key: "TT", name: "Team - Telephony" },
  { key: "TRG", name: "Team RUMA GPT" },
];

function statusCategoryKeyToDb(key) {
  // Jira's own statusCategory.key values: 'new' | 'indeterminate' | 'done'
  return key;
}

async function run({ syncType = "manual", asOf = new Date() } = {}) {
  const pool = makePool();
  const syncRun = await pool.query(
    `insert into sync_runs (started_at, status, sync_type, watermark_before) values (now(), 'running', $1, null) returning id`,
    [syncType],
  );
  const syncRunId = syncRun.rows[0].id;
  let recordsProcessed = 0;

  try {
    const issues = readJsonl(CACHE("issues.raw.jsonl"));
    const epicsRaw = readJsonl(CACHE("epics.raw.jsonl"));
    const history = readJsonl(CACHE("history.raw.jsonl"));
    const teamsSeed = readJson(GENERATED("teams.seed.json")).people;
    const projectsClustered = readJson(GENERATED("projects.json")).projects;
    const trackedSprints = readJson(CACHE("tracked-sprints.json"));

    // ---- 1. jira_projects ----
    await upsert(
      pool,
      "jira_projects",
      JIRA_PROJECTS.map((p) => ({ jira_key: p.key, name: p.name })),
      { conflictColumns: ["jira_key"] },
    );
    const jiraProjectIdByKey = new Map(
      (await pool.query("select id, jira_key from jira_projects")).rows.map((r) => [r.jira_key, r.id]),
    );

    // ---- 2. teams + people ----
    const teamNames = [...new Set(teamsSeed.map((t) => t.team))];
    await upsert(pool, "teams", teamNames.map((name) => ({ name })), { conflictColumns: ["name"] });
    const teamIdByName = new Map((await pool.query("select id, name from teams")).rows.map((r) => [r.name, r.id]));

    const peopleFromIssues = new Map();
    for (const issue of issues) {
      for (const person of [issue.assignee, issue.reporter, ...(issue.worklogs || []).map((w) => ({ accountId: w.authorAccountId, name: w.authorName })), ...(issue.comments || []).map((c) => ({ accountId: c.authorAccountId, name: c.authorName }))]) {
        if (person && person.accountId) peopleFromIssues.set(person.accountId, person.name);
      }
    }
    for (const h of history) {
      if (h.assignee) peopleFromIssues.set(h.assignee.accountId, h.assignee.name);
    }
    const teamByAccount = new Map(teamsSeed.map((t) => [t.accountId, t]));
    const peopleRows = [...peopleFromIssues.entries()].map(([accountId, name]) => {
      const t = teamByAccount.get(accountId);
      return {
        jira_account_id: accountId,
        name,
        role: null,
        team_id: t ? teamIdByName.get(t.team) : null,
        team_guessed: t ? t.guessed : true,
        team_guess_reason: t ? t.guessReason : "No sprint ticket data for this person in the current tracked window",
        active: true,
        excluded: false,
        updated_at: new Date(),
      };
    });
    // Never clobber a manual team correction: once a human has set
    // team_guessed = false for someone, re-syncing must not silently
    // reassert the auto-guess over it. `name` and `updated_at` still
    // refresh unconditionally.
    if (peopleRows.length) {
      const cols = Object.keys(peopleRows[0]);
      for (let offset = 0; offset < peopleRows.length; offset += 500) {
        const chunk = peopleRows.slice(offset, offset + 500);
        const values = [];
        const tuples = chunk.map((row, i) => {
          const placeholders = cols.map((c) => {
            values.push(row[c]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await pool.query(
          `insert into people (${cols.join(", ")})
           values ${tuples.join(", ")}
           on conflict (jira_account_id) do update set
             name = excluded.name,
             team_id = case when people.team_guessed = false then people.team_id else excluded.team_id end,
             team_guessed = case when people.team_guessed = false then false else excluded.team_guessed end,
             team_guess_reason = case when people.team_guessed = false then people.team_guess_reason else excluded.team_guess_reason end,
             updated_at = excluded.updated_at`,
          values,
        );
      }
    }
    const personIdByAccount = new Map((await pool.query("select id, jira_account_id from people")).rows.map((r) => [r.jira_account_id, r.id]));
    recordsProcessed += peopleRows.length;

    // ---- 3. sprints (tracked only, for now) ----
    const sprintRows = trackedSprints.map((s) => ({
      jira_sprint_id: hashSprintId(s.jiraProjectKey, s.name),
      jira_project_id: jiraProjectIdByKey.get(s.jiraProjectKey),
      name: s.name,
      state: s.state,
      start_date: s.startDate,
      end_date: s.endDate,
      complete_date: null,
      is_tracked: true,
      updated_at: new Date(),
    }));
    await upsert(pool, "sprints", sprintRows, {
      conflictColumns: ["jira_sprint_id"],
      updateColumns: ["name", "state", "start_date", "end_date", "is_tracked", "updated_at"],
    });
    const sprintIdByProjectKey = new Map();
    {
      const { rows } = await pool.query(
        `select s.id, jp.jira_key from sprints s join jira_projects jp on jp.id = s.jira_project_id where s.is_tracked`,
      );
      for (const r of rows) sprintIdByProjectKey.set(r.jira_key, r.id);
    }

    // ---- 4. projects (conceptual) + project_jira_projects + epics ----
    const projectRows = projectsClustered.map((p) => ({
      slug: p.id,
      name: p.name,
      color: null,
      purpose: null,
      sprint_goal: null,
      health: "on_track",
      progress: null,
      owner_person_id: null,
      is_current: p.current,
      source: "epic_cluster",
      roadmap_go_live: null,
      roadmap_status: null,
      roadmap_tech_stack: null,
      roadmap_key_benefit: null,
      updated_at: new Date(),
    }));
    await upsert(pool, "projects", projectRows, {
      conflictColumns: ["slug"],
      updateColumns: ["name", "is_current", "updated_at"],
    });
    const projectIdBySlug = new Map((await pool.query("select id, slug from projects")).rows.map((r) => [r.slug, r.id]));
    recordsProcessed += projectRows.length;

    const pjpRows = [];
    for (const p of projectsClustered) {
      for (const jk of p.jiraProjects) {
        pjpRows.push({ project_id: projectIdBySlug.get(p.id), jira_project_id: jiraProjectIdByKey.get(jk) });
      }
    }
    await pool.query("delete from project_jira_projects");
    for (const row of pjpRows) {
      await pool.query(
        `insert into project_jira_projects (project_id, jira_project_id) values ($1, $2) on conflict do nothing`,
        [row.project_id, row.jira_project_id],
      );
    }

    const epicToProjectSlug = new Map();
    for (const p of projectsClustered) for (const e of p.epics) epicToProjectSlug.set(e.key, p.id);

    // Apply persisted manual corrections on top of the auto-clustering.
    // cluster-epics.mjs re-derives projects.json fresh from scratch on
    // every run and has no memory of prior human corrections; this is
    // where those corrections actually get re-applied so they survive a
    // re-sync instead of being silently overwritten by the next
    // auto-clustering pass.
    const { rows: overrideRows } = await pool.query("select epic_jira_key, forced_project_slug from project_overrides");
    for (const o of overrideRows) {
      if (projectIdBySlug.has(o.forced_project_slug)) {
        epicToProjectSlug.set(o.epic_jira_key, o.forced_project_slug);
      } else {
        console.warn(`[sync] project_overrides: unknown target slug "${o.forced_project_slug}" for epic ${o.epic_jira_key}, skipping`);
      }
    }

    const epicRows = epicsRaw.map((e) => ({
      jira_key: e.key,
      jira_project_id: jiraProjectIdByKey.get(e.project),
      project_id: projectIdBySlug.get(epicToProjectSlug.get(e.key)) ?? null,
      summary: e.summary,
      status: e.status,
      status_category: statusCategoryKeyToDb(e.statusCategory),
      resolved_at: e.resolutiondate,
      created_at: e.created,
      updated_at: e.updated,
    }));
    await upsert(pool, "epics", epicRows, {
      conflictColumns: ["jira_key"],
      updateColumns: ["project_id", "status", "status_category", "resolved_at", "updated_at"],
    });
    const epicIdByKey = new Map((await pool.query("select id, jira_key from epics")).rows.map((r) => [r.jira_key, r.id]));
    recordsProcessed += epicRows.length;

    // ---- 5. tickets, worklogs, comments (in-window sprint tickets) ----
    const ticketRows = issues.map((t) => ({
      jira_key: t.key,
      jira_project_id: jiraProjectIdByKey.get(t.project),
      epic_id: t.parent ? epicIdByKey.get(t.parent.key) ?? null : null,
      sprint_id: sprintIdByProjectKey.get(t.project) ?? null,
      summary: t.summary,
      issue_type: t.issuetype,
      status: t.status,
      status_category: statusCategoryKeyToDb(t.statusCategory),
      priority: t.priority ? t.priority.toLowerCase() : null,
      assignee_person_id: t.assignee ? personIdByAccount.get(t.assignee.accountId) ?? null : null,
      reporter_person_id: t.reporter ? personIdByAccount.get(t.reporter.accountId) ?? null : null,
      original_estimate_seconds: t.estimateSeconds,
      remaining_estimate_seconds: t.remainingSeconds,
      time_spent_seconds: t.spentSeconds || 0,
      labels: t.labels || [],
      created_at: t.created,
      updated_at: t.updated,
      resolved_at: t.resolutiondate,
      is_blocked: t.status.toLowerCase().includes("block"),
      last_synced_at: new Date(),
    }));
    await upsert(pool, "tickets", ticketRows, {
      conflictColumns: ["jira_key"],
      updateColumns: [
        "epic_id", "sprint_id", "summary", "status", "status_category", "priority",
        "assignee_person_id", "reporter_person_id", "original_estimate_seconds",
        "remaining_estimate_seconds", "time_spent_seconds", "labels", "updated_at",
        "resolved_at", "is_blocked", "last_synced_at",
      ],
    });
    const ticketIdByKey = new Map((await pool.query("select id, jira_key from tickets")).rows.map((r) => [r.jira_key, r.id]));
    recordsProcessed += ticketRows.length;

    const worklogRows = [];
    const commentRows = [];
    for (const t of issues) {
      const ticketId = ticketIdByKey.get(t.key);
      for (const wl of t.worklogs || []) {
        worklogRows.push({
          jira_worklog_id: wl.id,
          ticket_id: ticketId,
          author_person_id: personIdByAccount.get(wl.authorAccountId),
          started_at: wl.started,
          logged_at: wl.created,
          seconds: wl.seconds,
        });
      }
      for (const c of t.comments || []) {
        commentRows.push({
          jira_comment_id: c.authorAccountId + "-" + c.created, // slim cache doesn't carry Jira's comment id; created+author is unique enough here
          ticket_id: ticketId,
          author_person_id: c.authorAccountId ? personIdByAccount.get(c.authorAccountId) ?? null : null,
          created_at: c.created,
          body_excerpt: c.body,
        });
      }
    }
    if (worklogRows.length) {
      await upsert(pool, "worklogs", worklogRows, {
        conflictColumns: ["jira_worklog_id"],
        updateColumns: ["started_at", "logged_at", "seconds"],
      });
    }
    if (commentRows.length) {
      await upsert(pool, "ticket_comments", commentRows, {
        conflictColumns: ["jira_comment_id"],
        updateColumns: ["body_excerpt"],
      });
    }
    recordsProcessed += worklogRows.length + commentRows.length;

    // ---- 6. metrics: person_metrics, risks, standouts, board_health ----
    const epicToProjectId = new Map([...epicToProjectSlug.entries()].map(([k, slug]) => [k, projectIdBySlug.get(slug)]));
    const { personMetrics, risks, standouts, orgBoardHealth } = computeMetrics({
      asOf,
      trackedSprints,
      issues,
      epicToProjectId,
      teamSeed: teamsSeed,
      adjustments: {},
    });

    const personMetricRows = personMetrics.map((m) => ({
      person_id: personIdByAccount.get(m.accountId),
      bandwidth_hours: m.bandwidthHours,
      utilisation_pct: m.utilisationPct,
      hours_logged: m.hoursLogged,
      estimated_hours: m.estimatedHours,
      sprint_target_hours: m.sprintTargetHours,
      velocity: m.velocity,
      estimate_accuracy: m.estimateAccuracy,
      estimate_coverage: m.estimateCoverage,
      closed_without_logging: m.closedWithoutLogging,
      worklog_count: m.worklogCount,
      comment_count: m.commentCount,
      idle_workdays: m.idleWorkdays,
      dark_wip_count: m.darkWipCount,
      avg_log_lag_days: m.avgLogLagDays,
      health: m.health,
      risk_flags: m.riskFlags,
      target_hours_is_fallback: m.targetHoursIsFallback,
      overallocation_reason: m.overallocationReason,
      computed_at: new Date(),
    })).filter((r) => r.person_id);
    await upsert(pool, "person_metrics", personMetricRows, {
      conflictColumns: ["person_id"],
      updateColumns: Object.keys(personMetricRows[0] || {}).filter((c) => c !== "person_id"),
    });
    recordsProcessed += personMetricRows.length;
    // Append-only copy so the date-range filter on People/Team Health/
    // Resource Planning can show "as of" a past sync, not just the
    // live-overwritten latest snapshot above.
    await insertMany(pool, "person_metrics_history", personMetricRows);

    // Sprint overrun: the tracked sprint is still open well past its
    // planned end date -- a real "is scope realistic" signal, not just a
    // display quirk of the pace math (which is why utilisation reads
    // >100% for these teams).
    for (const s of trackedSprints) {
      const overdueDays = Math.round((asOf - new Date(s.endDate)) / 86400000);
      if (overdueDays > 0) {
        risks.push({
          category: "sprint_overrun",
          severity: overdueDays > 7 ? "high" : "medium",
          title: `${s.name} (${s.jiraProjectKey}) is ${overdueDays} day(s) past its planned end date and still open`,
          recommendation: "Close out or re-scope this sprint before planning the next one — utilisation and pace figures for this team are measured against the original window and will read as overrun until it's closed.",
          projectSlug: null,
          identifiedAt: asOf,
        });
      }
    }

    const riskRows = risks
      .map((r) => ({
        category: r.category,
        severity: r.severity,
        title: r.title,
        recommendation: r.recommendation,
        person_id: r.accountId ? personIdByAccount.get(r.accountId) ?? null : null,
        project_id: r.projectSlug ? projectIdBySlug.get(r.projectSlug) ?? null : null,
        ticket_id: null,
        identified_at: r.identifiedAt,
        status: "open",
        computed_at: new Date(),
      }));
    await replaceComputed(pool, "risks", riskRows, { scopeColumn: "status", scopeValue: "open" });

    const standoutRows = standouts.map((s) => ({
      title: s.title,
      person_id: personIdByAccount.get(s.accountId),
      detail: s.detail,
      rank: s.rank,
      computed_at: new Date(),
    })).filter((r) => r.person_id);
    await pool.query("delete from standouts");
    for (const row of standoutRows) {
      await pool.query(
        `insert into standouts (title, person_id, detail, rank, computed_at) values ($1,$2,$3,$4,$5)`,
        [row.title, row.person_id, row.detail, row.rank, row.computed_at],
      );
    }

    await pool.query(
      `insert into board_health (scope_type, scope_id, estimate_coverage_pct, blocked_tickets, dark_wip, missing_estimates, closed_without_logs, idle_engineers, avg_log_lag_days, stale_tickets, board_health_score)
       values ('org', null, $1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        orgBoardHealth.estimateCoveragePct, orgBoardHealth.blockedTickets, orgBoardHealth.darkWip,
        orgBoardHealth.missingEstimates, orgBoardHealth.closedWithoutLogs, orgBoardHealth.idleEngineers,
        orgBoardHealth.avgLogLagDays, orgBoardHealth.staleTickets, orgBoardHealth.boardHealthScore,
      ],
    );

    // ---- 7. project_contributors (current-sprint allocation) ----
    const contributorRows = [];
    for (const [slug, projectId] of projectIdBySlug) {
      const projectTickets = issues.filter((t) => t.parent && epicToProjectSlug.get(t.parent.key) === slug);
      const byPerson = new Map();
      for (const t of projectTickets) {
        if (!t.assignee) continue;
        const hours = (t.spentSeconds || 0) / 3600;
        byPerson.set(t.assignee.accountId, (byPerson.get(t.assignee.accountId) || 0) + hours);
      }
      const total = [...byPerson.values()].reduce((s, h) => s + h, 0) || 1;
      for (const [accountId, hours] of byPerson) {
        const personId = personIdByAccount.get(accountId);
        if (!personId) continue;
        contributorRows.push({
          project_id: projectId,
          person_id: personId,
          pct: Math.round((100 * hours) / total),
          hours: Math.round(hours * 10) / 10,
          computed_at: new Date(),
        });
      }
    }
    await pool.query("delete from project_contributors");
    for (const row of contributorRows) {
      await pool.query(
        `insert into project_contributors (project_id, person_id, pct, hours, computed_at) values ($1,$2,$3,$4,$5)
         on conflict (project_id, person_id) do update set pct = excluded.pct, hours = excluded.hours, computed_at = excluded.computed_at`,
        [row.project_id, row.person_id, row.pct, row.hours, row.computed_at],
      );
    }

    // ---- 8. project_updates (current initiatives) ----
    // Grouped by EPIC, not by fuzzy ticket-title re-clustering: an epic
    // ("Billing Configuration", "WhatsApp Integration") is already the
    // natural initiative container. Ticket-title clustering is reserved
    // for project_features below, where the real duplication this
    // project needs to catch is the SAME feature split across several
    // *different* epics' closed tickets, not within one epic's backlog.
    await pool.query("delete from project_updates");
    for (const [slug, projectId] of projectIdBySlug) {
      const projectTickets = issues.filter((t) => t.parent && epicToProjectSlug.get(t.parent.key) === slug);
      if (projectTickets.length === 0) continue;
      const byEpic = new Map();
      for (const t of projectTickets) {
        const epicKey = t.parent.key;
        if (!byEpic.has(epicKey)) byEpic.set(epicKey, { name: t.parent.summary, tickets: [] });
        byEpic.get(epicKey).tickets.push(t);
      }
      for (const [epicKey, group] of byEpic) {
        const done = group.tickets.filter((t) => t.statusCategory === "done").length;
        const progress = Math.round((100 * done) / group.tickets.length);
        const { rows } = await pool.query(
          `insert into project_updates (project_id, name, summary, progress) values ($1,$2,$3,$4) returning id`,
          [projectId, group.name, `${group.tickets.length} ticket(s) in ${epicKey} this sprint`, progress],
        );
        const updateId = rows[0].id;
        for (const t of group.tickets) {
          const ticketId = ticketIdByKey.get(t.key);
          if (ticketId) await pool.query(`insert into project_update_tickets (project_update_id, ticket_id) values ($1,$2) on conflict do nothing`, [updateId, ticketId]);
        }
      }
    }

    // ---- 9. project_features (delivered capabilities, from history) ----
    // history is only THIS run's delta -- persist it into
    // resolved_ticket_history so accumulated history survives across CI
    // runs (which start from an empty, gitignored cache/ every time),
    // then rebuild project_features from the FULL persisted set, not
    // just this run's slice.
    const historyRows = history
      .filter((h) => h.parent)
      .map((h) => ({
        jira_key: h.key,
        summary: h.summary,
        issuetype: h.issuetype,
        resolution_date: h.resolutiondate,
        spent_seconds: h.spentSeconds || 0,
        parent_epic_key: h.parent.key,
        updated_at: new Date(),
      }));
    await upsert(pool, "resolved_ticket_history", historyRows, {
      conflictColumns: ["jira_key"],
      updateColumns: ["summary", "issuetype", "resolution_date", "spent_seconds", "parent_epic_key", "updated_at"],
    });

    const { rows: allHistoryRows } = await pool.query(
      "select jira_key as key, summary, resolution_date as resolutiondate, spent_seconds as \"spentSeconds\", parent_epic_key from resolved_ticket_history",
    );

    await pool.query("delete from project_features");
    const historyByProject = new Map();
    for (const h of allHistoryRows) {
      const slug = epicToProjectSlug.get(h.parent_epic_key);
      if (!slug) continue;
      if (!historyByProject.has(slug)) historyByProject.set(slug, []);
      historyByProject.get(slug).push({ ...h, epicKey: h.parent_epic_key });
    }
    for (const [slug, tickets] of historyByProject) {
      const projectId = projectIdBySlug.get(slug);
      const clusters = clusterTicketTitles(tickets.map((t) => ({ summary: t.summary, epicKey: t.epicKey, key: t.key })));
      for (const cluster of clusters) {
        const hours = cluster.tickets.reduce((s, t) => {
          const full = tickets.find((x) => x.key === t.key);
          return s + (full?.spentSeconds || 0) / 3600;
        }, 0);
        const dates = cluster.tickets.map((t) => tickets.find((x) => x.key === t.key)?.resolutiondate).filter(Boolean).sort();
        const completionDate = dates[dates.length - 1] || null;
        const { rows } = await pool.query(
          `insert into project_features (project_id, name, description, completion_sprint, completion_date, hours) values ($1,$2,$3,$4,$5,$6) returning id`,
          [projectId, cluster.name, summarizeCluster(cluster), null, completionDate, Math.round(hours * 10) / 10],
        );
        const featureId = rows[0].id;
        for (const t of cluster.tickets) {
          const ticketId = ticketIdByKey.get(t.key);
          if (ticketId) await pool.query(`insert into project_feature_tickets (project_feature_id, ticket_id) values ($1,$2) on conflict do nothing`, [featureId, ticketId]);
        }
      }
    }

    await pool.query(
      `update sync_runs set finished_at = now(), status = 'success', records_processed = $1, watermark_after = $2 where id = $3`,
      [recordsProcessed, asOf, syncRunId],
    );
    console.log(`Sync complete. Records processed: ${recordsProcessed}`);
  } catch (err) {
    await pool.query(`update sync_runs set finished_at = now(), status = 'failed', error_message = $1 where id = $2`, [String(err.stack || err), syncRunId]);
    throw err;
  } finally {
    await pool.end();
  }
}

function hashSprintId(projectKey, name) {
  // Deterministic small int from project+name so re-runs upsert the same row.
  const str = `${projectKey}:${name}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const syncType = process.argv.includes("--full") ? "full" : process.argv.includes("--incremental") ? "incremental" : "manual";
  run({ syncType }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { run };
