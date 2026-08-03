// Single entrypoint for the GitHub Actions job (and for local manual
// runs): fetch fresh Jira data, re-derive the epic->project clustering
// and guessed team roster, then transform + upsert into Postgres.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { fetchAll } from "./fetch-jira-rest.mjs";
import { computeAssigneeProjectCounts } from "./lib/compute-assignee-counts.mjs";
import { run as runSync } from "./sync.mjs";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = (f) => path.join(__dirname, "cache", f);

async function getLastWatermark() {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `select watermark_after from sync_runs where status = 'success' order by finished_at desc limit 1`,
    );
    // pg returns timestamptz columns as Date objects, not ISO strings --
    // fetchHistory()'s JQL-building does string ops (sinceIso.slice) on this.
    const watermark = rows[0]?.watermark_after;
    return watermark instanceof Date ? watermark.toISOString() : (watermark ?? null);
  } catch {
    return null; // first-ever run: table may not have rows yet
  } finally {
    await pool.end();
  }
}

async function main() {
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
