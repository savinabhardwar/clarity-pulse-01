// Single entrypoint for the GitHub Actions job (and for local manual
// runs): fetch fresh Jira data, re-derive the epic->project clustering
// and guessed team roster, then transform + upsert into Postgres.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { fetchAll } from "./fetch-jira-rest.mjs";
import { computeAssigneeProjectCounts } from "./lib/compute-assignee-counts.mjs";
import { run as runSync } from "./sync.mjs";
import { snapshotClosedSprints } from "./snapshot-sprint-summary.mjs";
import { flagInactivePeople } from "./flag-inactive-people.mjs";
import { purgeClosedSprintTickets } from "./purge-closed-sprint-tickets.mjs";
import { runSmokeTest } from "./smoke-test.mjs";
import { withRetry, isRetryablePgError } from "./lib/retry.mjs";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = (f) => path.join(__dirname, "cache", f);

async function getLastWatermark() {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await withRetry(
      () => pool.query(`select watermark_after from sync_runs where status = 'success' order by finished_at desc limit 1`),
      { label: "getLastWatermark", isRetryable: isRetryablePgError },
    );
    // pg returns timestamptz columns as Date objects, not ISO strings --
    // fetchHistory()'s JQL-building does string ops (sinceIso.slice) on this.
    const watermark = rows[0]?.watermark_after;
    return watermark instanceof Date ? watermark.toISOString() : (watermark ?? null);
  } catch (err) {
    // Only a genuinely first-ever run (sync_runs table/rows don't exist
    // yet) should fall back to a full historical fetch -- a real
    // connectivity failure (already retried above and still failing)
    // must surface, not be silently treated as "first run" and trigger
    // an unnecessary full-history re-fetch.
    if (isRetryablePgError(err)) throw err;
    return null;
  } finally {
    await pool.end();
  }
}

// Fails fast with every missing var listed at once, instead of a vague
// error deep inside fetch-jira-rest.mjs or sync.mjs once the run is
// already partway through (e.g. "JIRA_EMAIL / JIRA_API_TOKEN not set"
// after already having spent time fetching from Jira with only half the
// required secrets, or a raw pg connection error with no hint that
// DATABASE_URL was simply never set).
function validateEnv() {
  const required = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "DATABASE_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`[run-full-sync] missing required environment variable(s): ${missing.join(", ")}`);
  }
}

async function main() {
  validateEnv();
  const syncType = process.argv.includes("--full") ? "full" : process.argv.includes("--incremental") ? "incremental" : "manual";
  console.log(`[run-full-sync] starting ${syncType} sync`);

  const watermark = syncType === "incremental" ? await getLastWatermark() : null;
  const fetchSummary = await fetchAll({ historyWatermark: watermark });
  console.log("[run-full-sync] fetched:", fetchSummary);

  computeAssigneeProjectCounts(CACHE("issues.raw.jsonl"), CACHE("assignee-project-counts.json"));

  // These two re-derive src/data/generated/projects.json and teams.seed.json
  // from the freshly-fetched cache -- run as child processes so their
  // existing top-level script behavior (designed for local CLI use)
  // works unchanged in CI too.
  await runScript(path.join(__dirname, "cluster-epics.mjs"));
  await runScript(path.join(__dirname, "build-teams-seed.mjs"));

  await runSync({ syncType });
  await runScript(path.join(__dirname, "generate-narratives.mjs"));

  // Idempotent -- only ever inserts a sprint's snapshot the first time
  // it's found closed, safe to run on every sync.
  const snapshotResult = await snapshotClosedSprints(process.env.DATABASE_URL);
  console.log("[run-full-sync] sprint summary snapshots:", snapshotResult);

  // Auto-excludes anyone the sync has been passively picking up (as a
  // ticket reporter or commenter, e.g. a customer contact) who has never
  // shown any real engineering activity -- see flag-inactive-people.mjs
  // for the exact bar and why it's not just "never assigned a ticket".
  const flagResult = await flagInactivePeople(process.env.DATABASE_URL);
  console.log("[run-full-sync] inactive-people flagging:", flagResult);

  // Must run after snapshotting -- only purges tickets from a sprint that
  // already has a person_sprint_summaries row (see purge-closed-sprint-
  // tickets.mjs for the full eligibility rule and grace period).
  const purgeResult = await purgeClosedSprintTickets(process.env.DATABASE_URL);
  console.log("[run-full-sync] closed-sprint ticket purge:", purgeResult);

  const smokeResult = await runSmokeTest(process.env.DATABASE_URL);
  if (!smokeResult.ok) {
    throw new Error(`[run-full-sync] smoke test failed: ${smokeResult.problems.join("; ")}`);
  }
  console.log("[run-full-sync] smoke test passed");

  console.log("[run-full-sync] done");
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${scriptPath} exited with code ${code}`))));
  });
}

main().catch((err) => {
  console.error("[run-full-sync] FAILED", err);
  process.exit(1);
});
