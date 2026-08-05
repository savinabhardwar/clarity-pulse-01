// Deletes ticket rows belonging to a sprint once it's closed, past a
// short grace period, AND already snapshotted (person_sprint_summaries
// has a row for it -- see snapshot-sprint-summary.mjs, which always runs
// first in run-full-sync.mjs). Without this, `tickets` grows forever:
// Jira sprints never auto-close, so old sprint rows just accumulate,
// and sync.mjs's untrack step (see sync.mjs's "4.5") only nulls out
// sprint_id for tickets that fell OUT of a still-tracked sprint -- it
// doesn't touch tickets whose sprint has been fully superseded by a
// newer tracked sprint for that project. Those are this script's target:
// by the time a sprint is closed + grace-period'd + snapshotted, anything
// still pointing at it is done, or was truly abandoned there, and its
// per-person/per-project scores are already durably captured.
//
// Safe to run unconditionally on every sync -- purges nothing if there's
// no newly-eligible sprint. Deleting a ticket cascades to worklogs,
// ticket_comments, project_update_tickets, project_feature_tickets (all
// ON DELETE CASCADE); risks.ticket_id is never populated so it can't
// conflict. Completed-ticket history survives via resolved_ticket_history
// (durable, unaffected by this -- see migrations 0038/0039), which is why
// get_person_detail's Completed panel was repointed there instead of
// reading live `tickets` rows.
import pg from "pg";
import { pathToFileURL } from "node:url";

// Buffer after a sprint's end_date before its tickets are purged, in case
// a final worklog/comment lands a little late relative to Jira's own
// end_date timestamp.
const GRACE_DAYS = 2;

export async function purgeClosedSprintTickets(databaseUrl) {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  try {
    // Requires a row in BOTH summary tables, not just person-level -- a
    // sprint snapshotted for people but not yet for projects (the exact
    // bug this once hit -- see snapshot-sprint-summary.mjs's
    // findUnsnapshottedClosedSprints) must never be purged, since that
    // would delete the only source data project-level history could ever
    // be computed from.
    const { rows: eligibleSprints } = await pool.query(
      `select distinct s.id, s.name, s.start_date, s.end_date
       from sprints s
       where s.end_date < now() - make_interval(days => $1)
         and exists (select 1 from person_sprint_summaries pss where pss.sprint_start = s.start_date)
         and exists (select 1 from project_sprint_summaries pjs where pjs.sprint_start = s.start_date)
         and exists (select 1 from tickets tk where tk.sprint_id = s.id)`,
      [GRACE_DAYS],
    );

    if (eligibleSprints.length === 0) {
      console.log("[purge-closed-sprint-tickets] nothing to purge");
      return { sprintsPurged: 0, ticketsDeleted: 0 };
    }

    let totalDeleted = 0;
    for (const sprint of eligibleSprints) {
      const { rowCount } = await pool.query(`delete from tickets where sprint_id = $1`, [sprint.id]);
      totalDeleted += rowCount;
      console.log(
        `[purge-closed-sprint-tickets] purged ${rowCount} ticket(s) from "${sprint.name}" (closed ${new Date(sprint.end_date).toISOString()})`,
      );
    }
    return { sprintsPurged: eligibleSprints.length, ticketsDeleted: totalDeleted };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await purgeClosedSprintTickets(databaseUrl);
  console.log("[purge-closed-sprint-tickets] done:", result);
}
