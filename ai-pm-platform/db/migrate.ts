// Minimal, idempotent forward-only migration runner. Applies every
// db/migrations/*.sql file in order, tracked in a _migrations table so a
// re-run only applies what's new -- this is what makes "clone, run one
// command, get a populated local DB" (task 2.6) actually true, instead of
// a developer having to know to run 5 files by hand in order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "migrations");

function loadEnv(): Record<string, string> {
  const devVarsPath = path.join(here, "..", ".dev.vars");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(devVarsPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m?.[1] !== undefined && m[2] !== undefined) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: env["DATABASE_URL"],
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    create table if not exists _migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows: applied } = await client.query<{ filename: string }>(
    "select filename from _migrations",
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into _migrations (filename) values ($1)", [file]);
      await client.query("commit");
      appliedCount += 1;
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  console.log(
    appliedCount === 0 ? "No new migrations to apply." : `Applied ${appliedCount} migration(s).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
