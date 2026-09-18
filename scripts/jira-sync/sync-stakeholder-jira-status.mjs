// Keeps project-compass's stakeholder_items in sync with the real status of
// whatever Jira ticket they're linked to (stakeholder_item_jira_links).
//
// project-compass's own item-form.tsx writes status+statusKind='jira' the
// moment a link is first made (the exact real Jira status name, e.g.
// "Testing" -- not collapsed into a smaller bucket), but has no ongoing
// sync of its own -- once a linked ticket moves in Jira, the stakeholder
// item is stuck showing the stale status forever. Piggy-
// backing this onto the existing scheduled Jira sync (run-full-sync.mjs)
// means every linked item's status gets refreshed on the same cadence as
// the rest of ClarityPulse's data, with no separate cron/infra needed.
//
// Deliberately queries Jira directly for exactly the linked keys (`key in
// (...)`) rather than reusing fetch-jira-rest.mjs's cache: that cache only
// covers each team's *current* sprint plus recently-closed child tickets
// with a parent epic, so an older or parent-less linked ticket (there are
// plenty -- these links span client-request-driven work, not just
// sprint-tracked engineering tickets) would silently never get refreshed.
import pg from "pg";
import { pathToFileURL } from "node:url";
import { withRetry, isRetryableHttpStatus } from "./lib/retry.mjs";

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

const CHUNK_SIZE = 50; // keeps each JQL `key in (...)` clause a reasonable length

async function fetchStatuses(jiraBaseUrl, keys) {
  const statusByKey = new Map();
  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const jql = `key in (${chunk.join(",")})`;
    const issues = await withRetry(
      async () => {
        const res = await fetch(`${jiraBaseUrl}/rest/api/3/search/jql`, {
          method: "POST",
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ jql, fields: ["status"], maxResults: chunk.length }),
        });
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Jira search failed: ${res.status} ${text}`);
          err.status = res.status;
          throw err;
        }
        const body = await res.json();
        return body.issues ?? [];
      },
      { label: "fetchStatuses", isRetryable: (err) => isRetryableHttpStatus(err?.status ?? 0) },
    );
    for (const issue of issues) {
      statusByKey.set(issue.key, issue.fields?.status?.name);
    }
  }
  return statusByKey;
}

export async function syncStakeholderJiraStatus(databaseUrl, jiraBaseUrl = process.env.JIRA_BASE_URL) {
  if (!jiraBaseUrl) throw new Error("JIRA_BASE_URL not set");
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  try {
    const { rows: links } = await pool.query(`
      select l.jira_key, si.id as item_id, si.status as old_status
      from stakeholder_item_jira_links l
      join stakeholder_items si on si.id = l.item_id
      where si.deleted_at is null
    `);

    if (links.length === 0) {
      console.log("[sync-stakeholder-jira-status] no linked items to sync");
      return { updated: 0, missing: [] };
    }

    const keys = [...new Set(links.map((l) => l.jira_key))];
    const statusByKey = await fetchStatuses(jiraBaseUrl, keys);

    const missing = keys.filter((k) => !statusByKey.has(k));
    if (missing.length > 0) {
      console.warn(
        `[sync-stakeholder-jira-status] ${missing.length} linked key(s) not found in Jira (deleted/moved?): ${missing.join(", ")}`,
      );
    }

    await pool.query("select set_config('app.current_actor', 'jira-sync', false)");

    let updated = 0;
    for (const link of links) {
      const realStatus = statusByKey.get(link.jira_key);
      if (!realStatus) continue;
      if (realStatus === link.old_status) continue; // trigger logs on any write, skip no-ops
      await pool.query(
        `update stakeholder_items set status = $1, status_kind = 'jira', updated_at = now() where id = $2`,
        [realStatus, link.item_id],
      );
      updated++;
    }

    console.log(
      `[sync-stakeholder-jira-status] checked ${links.length} link(s) across ${keys.length} ticket(s), updated ${updated}`,
    );
    return { updated, missing };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await syncStakeholderJiraStatus(databaseUrl);
  console.log("[sync-stakeholder-jira-status] done:", result);
}
