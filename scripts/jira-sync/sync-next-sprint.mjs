// Refreshes `next_sprint_tickets` (migration 0069) -- the issues already
// placed in each board's NEXT sprint, for team-pulse-54's "Next Sprint
// Planning" page.
//
// fetch-jira-rest.mjs only ever ingests each board's ACTIVE sprint (and
// everything downstream -- `tickets`, the scoring views, the closed-sprint
// purge -- assumes that), so future-sprint issues deliberately live in their
// own table instead of being folded into `tickets`. Like
// sync-stakeholder-jira-status.mjs this queries Jira directly and is
// independent of the fetch cache, so run-full-sync.mjs runs it non-fatally.
//
// "Next sprint" = per board, the earliest `future`-state sprint that has
// issues in it. Jira usually leaves a future sprint's dates empty until it's
// started, so ordering falls back to sprint id (ids are allocated in creation
// order). A sprint with no issues yet can't be discovered this way -- the
// board simply has nothing to plan against, which the page shows as such.
import pg from "pg";
import { pathToFileURL } from "node:url";
import { withRetry, isRetryableHttpStatus, isRetryablePgError } from "./lib/retry.mjs";
import { JIRA_PROJECTS } from "./fetch-jira-rest.mjs";

const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || "customfield_10020";

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function searchPage(jiraBaseUrl, body) {
  return withRetry(
    async () => {
      const res = await fetch(`${jiraBaseUrl}/rest/api/3/search/jql`, {
        method: "POST",
        headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Jira search failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    {
      label: "next-sprint search",
      isRetryable: (err) => isRetryableHttpStatus(err?.status ?? 0),
    },
  );
}

async function fetchFutureSprintIssues(jiraBaseUrl) {
  const projectClause = JIRA_PROJECTS.map((p) => `"${p.name}"`).join(", ");
  // Epics are containers, not plannable work (same exclusion as the
  // active-sprint fetch); Done issues carried into a future sprint have no
  // work left to plan.
  const jql = `project in (${projectClause}) AND Sprint in futureSprints() AND issuetype != Epic AND statusCategory != Done`;
  const fields = [
    "summary",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "timeoriginalestimate",
    "project",
    SPRINT_FIELD,
  ];
  const issues = [];
  let nextPageToken;
  do {
    const body = await searchPage(jiraBaseUrl, { jql, fields, maxResults: 100, nextPageToken });
    issues.push(...(body.issues ?? []));
    nextPageToken = body.nextPageToken;
  } while (nextPageToken);
  return issues;
}

// Earliest future sprint wins: by start date when Jira has one, then by id.
function compareSprints(a, b) {
  const aStart = a.startDate ? Date.parse(a.startDate) : Infinity;
  const bStart = b.startDate ? Date.parse(b.startDate) : Infinity;
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  return a.id - b.id;
}

/**
 * Pure: raw Jira issues -> `next_sprint_tickets` rows. Per project, picks the
 * earliest future sprint any of its issues sit in, and keeps only the issues
 * that belong to it (an issue also queued in a LATER future sprint still
 * counts for the earlier one; one only in a later sprint is dropped).
 *
 * `personIdByAccount` maps Jira account id -> people.id (aliases already
 * folded in by the caller). Unknown/absent assignees get a null person id but
 * keep their display name.
 */
export function buildNextSprintRows(issues, projects, personIdByAccount, sprintField = SPRINT_FIELD) {
  const nameByKey = new Map(projects.map((p) => [p.key, p.name]));
  const byProject = new Map();
  for (const issue of issues) {
    const key = issue.fields?.project?.key;
    if (!key || !nameByKey.has(key)) continue;
    (byProject.get(key) ?? byProject.set(key, []).get(key)).push(issue);
  }

  const rows = [];
  for (const [projectKey, projectIssues] of byProject) {
    const futureSprintsOf = (issue) =>
      (issue.fields?.[sprintField] ?? []).filter((s) => s?.state === "future");

    const candidates = new Map();
    for (const issue of projectIssues) {
      for (const s of futureSprintsOf(issue)) candidates.set(s.id, s);
    }
    if (candidates.size === 0) continue;
    const next = [...candidates.values()].sort(compareSprints)[0];

    for (const issue of projectIssues) {
      if (!futureSprintsOf(issue).some((s) => s.id === next.id)) continue;
      const f = issue.fields;
      const accountId = f.assignee?.accountId ?? null;
      rows.push({
        jira_key: issue.key,
        jira_project_key: projectKey,
        board_name: nameByKey.get(projectKey),
        jira_sprint_id: next.id,
        sprint_name: next.name,
        sprint_start_date: next.startDate ?? null,
        sprint_end_date: next.endDate ?? null,
        // Jira returns "" rather than omitting an unset goal.
        sprint_goal: next.goal || null,
        summary: f.summary ?? "",
        issue_type: f.issuetype?.name ?? null,
        status: f.status?.name ?? "Unknown",
        priority: f.priority?.name ?? null,
        assignee_person_id: accountId ? (personIdByAccount.get(accountId) ?? null) : null,
        assignee_name: f.assignee?.displayName ?? null,
        original_estimate_seconds: f.timeoriginalestimate ?? null,
      });
    }
  }
  return rows;
}

const COLUMNS = [
  "jira_key",
  "jira_project_key",
  "board_name",
  "jira_sprint_id",
  "sprint_name",
  "sprint_start_date",
  "sprint_end_date",
  "sprint_goal",
  "summary",
  "issue_type",
  "status",
  "priority",
  "assignee_person_id",
  "assignee_name",
  "original_estimate_seconds",
];

export async function syncNextSprint(databaseUrl, jiraBaseUrl = process.env.JIRA_BASE_URL) {
  if (!jiraBaseUrl) throw new Error("JIRA_BASE_URL not set");
  // Fetch first: if Jira is unreachable this throws before the table is
  // touched, so a transient outage never blanks the page.
  const issues = await fetchFutureSprintIssues(jiraBaseUrl);

  const { Pool } = pg;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  try {
    const [{ rows: people }, { rows: aliases }] = await withRetry(
      () =>
        Promise.all([
          pool.query("select id, jira_account_id from people"),
          pool.query(
            "select alias_jira_account_id, canonical_jira_account_id from person_account_aliases",
          ),
        ]),
      { label: "next-sprint people lookup", isRetryable: isRetryablePgError },
    );
    const personIdByAccount = new Map(people.map((p) => [p.jira_account_id, p.id]));
    // An alias account resolves to its canonical account's person (see 0023).
    for (const a of aliases) {
      const id = personIdByAccount.get(a.canonical_jira_account_id);
      if (id) personIdByAccount.set(a.alias_jira_account_id, id);
    }

    const rows = buildNextSprintRows(issues, JIRA_PROJECTS, personIdByAccount);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from next_sprint_tickets");
      for (const r of rows) {
        await client.query(
          `insert into next_sprint_tickets (${COLUMNS.join(", ")})
           values (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
          COLUMNS.map((c) => r[c]),
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    const sprints = new Set(rows.map((r) => r.jira_sprint_id));
    console.log(
      `[sync-next-sprint] ${rows.length} ticket(s) across ${sprints.size} next sprint(s) (${issues.length} future-sprint issue(s) fetched)`,
    );
    return { tickets: rows.length, sprints: sprints.size };
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const result = await syncNextSprint(databaseUrl);
  console.log("[sync-next-sprint] done:", result);
}
