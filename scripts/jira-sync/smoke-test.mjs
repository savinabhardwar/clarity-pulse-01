// Post-sync sanity check. The stale-DB-password incident (sync "ran" and
// exited 0 for the fetch/cluster steps, but the final DB write silently
// failed) showed that a sync can look fine in the logs while writing
// nothing -- this catches that class of failure by asserting the DB
// actually has fresh data after a run, not just that no step threw.
import pg from "pg";
import { pathToFileURL } from "node:url";

const FRESHNESS_WINDOW_MINUTES = 30;

export async function runSmokeTest(databaseUrl) {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  const problems = [];
  try {
    const { rows: freshRows } = await pool.query(
      `select count(*)::int as count from tickets where last_synced_at >= now() - make_interval(mins => $1)`,
      [FRESHNESS_WINDOW_MINUTES],
    );
    if (freshRows[0].count === 0) {
      problems.push(`no ticket has last_synced_at within the last ${FRESHNESS_WINDOW_MINUTES} minutes -- the sync ran but wrote nothing`);
    }

    const { rows: totalRows } = await pool.query(`select count(*)::int as count from tickets`);
    if (totalRows[0].count === 0) {
      problems.push("tickets table is empty");
    }

    const { rows: lastRun } = await pool.query(
      `select status from sync_runs order by started_at desc limit 1`,
    );
    if (lastRun[0]?.status !== "success") {
      problems.push(`most recent sync_runs row has status "${lastRun[0]?.status ?? "none"}", not "success"`);
    }

    return { ok: problems.length === 0, problems };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await runSmokeTest(databaseUrl);
  console.log("[smoke-test]", result);
  if (!result.ok) {
    console.error("[smoke-test] FAILED:", result.problems.join("; "));
    process.exit(1);
  }
}
