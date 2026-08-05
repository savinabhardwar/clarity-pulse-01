// Auto-excludes people who show up in Jira's assignee/reporter/worklog-
// author/comment-author fields (sync.mjs's peopleFromIssues picks up
// anyone appearing in ANY of those, indiscriminately) but have never
// actually done real engineering work -- confirmed live 2026-08-05: four
// people (Shane Williams, Matt Sullivan, Matthew Button, Shilpa
// Shivakumar) had zero tickets ever assigned to them and zero hours ever
// logged across all 6 historical sprint snapshots -- their only Jira
// footprint was as a ticket reporter or commenter (customer/stakeholder
// contacts, not engineers), yet they showed up on the leaderboard tagged
// "Nothing assigned this sprint" like a real idle team member.
//
// The bar for "real activity" deliberately isn't just "ever assigned a
// ticket" -- Sharat Naik has never been directly assigned anything either,
// but logged 51 real hours against a ticket assigned to someone else in a
// past sprint (helping out without holding the assignment), which is
// exactly the kind of real signal that should keep someone on the
// leaderboard. So the rule is: excluded if they have NO current-sprint
// assignment AND no historical sprint snapshot shows any allocated or
// logged hours at all.
//
// Never overrides team_guessed = false (a human has manually reviewed
// and placed this person on a team -- their exclusion status is that
// human's call from here on, not this script's), and requires at least
// one historical sprint snapshot to exist before flagging anyone -- a
// genuinely new hire with no snapshot history yet has nothing to be
// judged on, not a confirmed zero.
import pg from "pg";
import { pathToFileURL } from "node:url";

export async function flagInactivePeople(databaseUrl) {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  try {
    const { rows: candidates } = await pool.query(`
      select p.id, p.name
      from people p
      where p.active and not p.excluded and p.team_guessed = true
        and not exists (select 1 from tickets tk where tk.assignee_person_id = p.id)
        and exists (select 1 from person_sprint_summaries pss where pss.person_id = p.id)
        and not exists (
          select 1 from person_sprint_summaries pss
          where pss.person_id = p.id and (pss.allocated_hours > 0 or pss.logged_hours > 0)
        )
    `);

    if (candidates.length === 0) {
      console.log("[flag-inactive-people] no newly-inactive people found");
      return { flagged: [] };
    }

    const ids = candidates.map((c) => c.id);
    await pool.query(`update people set excluded = true where id = any($1)`, [ids]);
    console.log(`[flag-inactive-people] excluded ${candidates.length} person(s):`, candidates.map((c) => c.name).join(", "));
    return { flagged: candidates.map((c) => c.name) };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await flagInactivePeople(databaseUrl);
  console.log("[flag-inactive-people] done:", result);
}
