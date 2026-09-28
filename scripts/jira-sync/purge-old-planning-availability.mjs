// Deletes planning_availability (leave/availability) rows once every
// closed sprint they overlap has been snapshotted and none of that
// overlap touches a still-open sprint -- mirrors purge-closed-sprint-
// tickets.mjs's eligibility rule (closed + grace period + already
// snapshotted) so leave history is never dropped before
// snapshot-sprint-summary.mjs has had a chance to read it for that
// sprint's leave-adjusted pace scores.
//
// Without this, planning_availability just grows forever -- rows are
// hand-entered via the Planning page's Availability form (team-pulse-54)
// and nothing ever cleared them, so entries from sprints that closed
// months ago kept showing up in that same list (found live: previous
// sprints' leave still listed on the Planning page).
//
// An entry is eligible once its date range doesn't OVERLAP any
// currently-tracked sprint on any board (org has 15+ boards, and a board
// whose sprint overran in Jira -- nobody clicked "Complete Sprint" --
// stays is_tracked = true well past its calendar end_date, see 0067's
// v_canonical_sprint fix; that overrun sprint can still legitimately read
// this entry for its own live capacity math) -- AND no CLOSED sprint
// (is_tracked = false, end_date in the past) overlapping it is missing a
// person_sprint_summaries row, so a sprint that closed but hasn't been
// snapshotted yet can't lose the leave data its pace score still needs.
// GRACE_DAYS matches purge-closed-sprint-tickets.mjs, giving the
// snapshot job (which runs first, every sync) time to actually land.
import pg from "pg";
import { pathToFileURL } from "node:url";

const GRACE_DAYS = 2;

export async function purgeOldPlanningAvailability(databaseUrl) {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  try {
    const { rowCount } = await pool.query(
      `delete from planning_availability pa
       where pa.to_date < now() - make_interval(days => $1)
         and not exists (
           select 1 from sprints s
           where s.is_tracked
             and s.start_date is not null and s.end_date is not null
             and s.start_date::date <= pa.to_date
             and s.end_date::date >= pa.from_date
         )
         and not exists (
           select 1 from sprints s
           where not s.is_tracked
             and s.end_date < now()
             and s.start_date::date <= pa.to_date
             and s.end_date::date >= pa.from_date
             and not exists (
               select 1 from person_sprint_summaries pss where pss.sprint_start = s.start_date
             )
         )`,
      [GRACE_DAYS],
    );

    if (rowCount > 0) {
      console.log(`[purge-old-planning-availability] purged ${rowCount} stale leave entr${rowCount === 1 ? "y" : "ies"}`);
    } else {
      console.log("[purge-old-planning-availability] nothing to purge");
    }
    return { entriesDeleted: rowCount };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await purgeOldPlanningAvailability(databaseUrl);
  console.log("[purge-old-planning-availability] done:", result);
}
