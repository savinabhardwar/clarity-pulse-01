// Seeds one synthetic project with members. Idempotent -- safe to run
// more than once (upserts on each table's natural unique key: projects.code,
// users.email), so a developer who reruns this after a mistake doesn't
// hit duplicate-key errors. Run `npm run migrate` first (or `npm run
// db:setup` for both in one command) -- this script assumes the schema
// from migrations 0001-0005 already exists.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): Record<string, string> {
  const devVarsPath = path.join(here, "..", "..", ".dev.vars");
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

  const {
    rows: [project],
  } = await client.query(
    `insert into projects (name, code, description, status, jira_project_key, dev_branch)
     values ('Demo Project', 'DEMO', 'Synthetic project for local development and testing -- not a real Jira project.', 'active', null, 'development')
     on conflict (code) do update set name = excluded.name
     returning id`,
  );

  const seedUsers = [
    { name: "Demo Admin", email: "demo.admin@example.com", role: "admin" },
    { name: "Demo PM", email: "demo.pm@example.com", role: "pm" },
    { name: "Demo Developer", email: "demo.dev@example.com", role: "member" },
    { name: "Demo QA", email: "demo.qa@example.com", role: "member" },
  ];

  const userIds: Record<string, string> = {};
  for (const u of seedUsers) {
    const {
      rows: [row],
    } = await client.query(
      `insert into users (name, email, role)
       values ($1, $2, $3)
       on conflict (email) do update set name = excluded.name, role = excluded.role
       returning id`,
      [u.name, u.email, u.role],
    );
    userIds[u.email] = row.id;
  }

  await client.query(
    `insert into project_configurations (project_id, project_lead_id)
     values ($1, $2)
     on conflict (project_id) do update set project_lead_id = excluded.project_lead_id`,
    [project.id, userIds["demo.pm@example.com"]],
  );

  const memberRoles: Record<string, string> = {
    "demo.admin@example.com": "admin",
    "demo.pm@example.com": "lead",
    "demo.dev@example.com": "developer",
    "demo.qa@example.com": "qa",
  };
  for (const [email, role] of Object.entries(memberRoles)) {
    await client.query(
      `insert into project_members (project_id, user_id, role)
       values ($1, $2, $3)
       on conflict (project_id, user_id) do update set role = excluded.role`,
      [project.id, userIds[email], role],
    );
  }

  console.log(`Seeded project "Demo Project" (${project.id}) with ${seedUsers.length} members.`);
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
