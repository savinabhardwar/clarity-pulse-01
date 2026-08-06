// Production Jira fetcher for the GitHub Actions runner (no MCP access
// there -- MCP tools only exist inside interactive Claude sessions).
// Mirrors the exact JQL/fields used to build the verified local cache,
// but resolves each project's CURRENT sprint dynamically via
// `Sprint in openSprints()` instead of a hardcoded sprint name, so it
// self-corrects when a team's sprint rolls over (this is exactly the
// bug found during development: a hardcoded "Team Sprint 32" silently
// went stale once the board moved on to "Team Sprint 35").

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withRetry, isRetryableHttpStatus } from "./lib/retry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");

const JIRA_BASE = process.env.JIRA_BASE_URL; // e.g. https://alldaypa.atlassian.net
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || "customfield_10020";

const JIRA_PROJECTS = [
  { key: "TEAM", name: "Team-PixelBlinders" },
  { key: "TI", name: "Team - Infrastructure" },
  { key: "TEAMSANKYA", name: "Team Sankya" },
  { key: "TT", name: "Team - Telephony" },
  { key: "TRG", name: "Team RUMA GPT" },
];

function authHeader() {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

// A single page's request+response, wrapped in retry -- rate limiting
// (429) and transient 5xx responses are common on a large paginated
// fetch across 5 projects' full ticket/worklog/comment history and
// shouldn't fail the entire sync. A genuine 400 (bad JQL) or 401/403
// (bad token/permissions) fails immediately instead of burning retries
// on something that will never succeed.
async function jiraSearchPage({ jql, fields, maxResults, nextPageToken }) {
  return withRetry(
    async () => {
      const res = await fetch(`${JIRA_BASE}/rest/api/3/search/jql`, {
        method: "POST",
        headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ jql, fields, maxResults, nextPageToken }),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Jira search failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    { label: `Jira search (jql=${jql.slice(0, 60)}...)`, isRetryable: (err) => isRetryableHttpStatus(err.status) },
  );
}

async function jiraSearch({ jql, fields, maxResults = 100 }) {
  const results = [];
  let nextPageToken;
  do {
    const body = await jiraSearchPage({ jql, fields, maxResults, nextPageToken });
    results.push(...body.issues);
    nextPageToken = body.nextPageToken;
  } while (nextPageToken);
  return results;
}

function slimIssue(issue) {
  const f = issue.fields;
  return {
    key: issue.key,
    project: f.project.key,
    summary: f.summary,
    issuetype: f.issuetype?.name,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    priority: f.priority?.name ?? null,
    assignee: f.assignee ? { accountId: f.assignee.accountId, name: f.assignee.displayName } : null,
    reporter: f.reporter ? { accountId: f.reporter.accountId, name: f.reporter.displayName } : null,
    created: f.created,
    updated: f.updated,
    resolutiondate: f.resolutiondate ?? null,
    estimateSeconds: f.timeoriginalestimate ?? null,
    remainingSeconds: f.timeestimate ?? null,
    spentSeconds: f.timespent ?? 0,
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary, issuetype: f.parent.fields?.issuetype?.name } : null,
    labels: f.labels ?? [],
    worklogs: (f.worklog?.worklogs ?? []).map((w) => ({
      id: w.id,
      authorAccountId: w.author.accountId,
      authorName: w.author.displayName,
      started: w.started,
      created: w.created,
      seconds: w.timeSpentSeconds,
    })),
    comments: (f.comment?.comments ?? []).map((c) => ({
      authorAccountId: c.author?.accountId,
      authorName: c.author?.displayName,
      created: c.created,
      body: typeof c.body === "string" ? c.body.slice(0, 200) : "",
    })),
  };
}

async function fetchTrackedSprints() {
  const tracked = [];
  for (const p of JIRA_PROJECTS) {
    const issues = await jiraSearch({
      jql: `project = "${p.name}" AND Sprint in openSprints()`,
      fields: [SPRINT_FIELD],
      maxResults: 1,
    });
    if (issues.length === 0) continue;
    const sprints = issues[0].fields[SPRINT_FIELD] || [];
    const active = sprints.find((s) => s.state === "active") || sprints[sprints.length - 1];
    if (!active) continue;
    tracked.push({
      jiraProjectKey: p.key,
      name: active.name,
      startDate: active.startDate,
      endDate: active.endDate,
      state: active.state,
    });
  }
  return tracked;
}

async function fetchInWindowIssues(trackedSprints) {
  // issuetype != Epic -- an Epic sitting in a sprint is a container, not
  // a work item someone logs hours against directly; work happens on
  // its CHILD tickets. Without this exclusion an Epic assigned to
  // someone (a common ownership convention) got ingested into `tickets`
  // like any other ticket and then wrongly counted as neglected WIP --
  // dark-WIP penalized the assignee for not logging a worklog/comment
  // against the Epic itself, which nobody ever would. Mirrors
  // fetchHistory's existing exclusion below.
  const clause = trackedSprints
    .map((s) => JIRA_PROJECTS.find((p) => p.key === s.jiraProjectKey))
    .filter(Boolean)
    .map((p, i) => `(project = "${p.name}" AND Sprint = "${trackedSprints[i].name}" AND issuetype != Epic)`)
    .join(" OR ");
  if (!clause) return [];
  const issues = await jiraSearch({
    jql: clause,
    fields: ["summary", "status", "issuetype", "priority", "assignee", "reporter", "created", "updated", "resolutiondate", "timeoriginalestimate", "timeestimate", "timespent", "parent", "project", "worklog", "comment", "labels"],
  });
  return issues.map(slimIssue);
}

async function fetchEpics() {
  const projectClause = JIRA_PROJECTS.map((p) => `"${p.name}"`).join(", ");
  const issues = await jiraSearch({
    jql: `project in (${projectClause}) AND issuetype = Epic ORDER BY project ASC, key ASC`,
    fields: ["summary", "status", "project", "created", "updated", "resolutiondate"],
  });
  return issues.map((issue) => ({
    key: issue.key,
    project: issue.fields.project.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    statusCategory: issue.fields.status.statusCategory.key,
    created: issue.fields.created,
    updated: issue.fields.updated,
    resolutiondate: issue.fields.resolutiondate ?? null,
  }));
}

/** Incremental: fetch history resolved strictly after `sinceIso`. Full: fetch the most recent `limit`. */
async function fetchHistory({ sinceIso, limit = 500 }) {
  const projectClause = JIRA_PROJECTS.map((p) => `"${p.name}"`).join(", ");
  const jql = sinceIso
    ? `project in (${projectClause}) AND issuetype != Epic AND resolution is not EMPTY AND parent is not EMPTY AND resolutiondate > "${sinceIso.slice(0, 16).replace("T", " ")}" ORDER BY resolutiondate ASC`
    : `project in (${projectClause}) AND issuetype != Epic AND resolution is not EMPTY AND parent is not EMPTY ORDER BY resolutiondate DESC`;
  const issues = await jiraSearch({
    jql,
    fields: ["summary", "issuetype", "resolutiondate", "timespent", "assignee", "parent", "project"],
    maxResults: sinceIso ? 100 : Math.min(limit, 100),
  });
  const slim = issues.map((issue) => ({
    key: issue.key,
    project: issue.fields.project.key,
    summary: issue.fields.summary,
    issuetype: issue.fields.issuetype.name,
    resolutiondate: issue.fields.resolutiondate,
    spentSeconds: issue.fields.timespent ?? 0,
    assignee: issue.fields.assignee ? { accountId: issue.fields.assignee.accountId, name: issue.fields.assignee.displayName } : null,
    parent: issue.fields.parent ? { key: issue.fields.parent.key, summary: issue.fields.parent.fields?.summary } : null,
  }));
  return sinceIso ? slim : slim.slice(0, limit);
}

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export async function fetchAll({ historyWatermark } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });

  const trackedSprints = await fetchTrackedSprints();
  writeFileSync(path.join(CACHE_DIR, "tracked-sprints.json"), JSON.stringify(trackedSprints, null, 2));

  const issues = await fetchInWindowIssues(trackedSprints);
  writeJsonl(path.join(CACHE_DIR, "issues.raw.jsonl"), issues);

  const epics = await fetchEpics();
  writeJsonl(path.join(CACHE_DIR, "epics.raw.jsonl"), epics);

  // This run's delta only -- durable accumulation across runs lives in
  // the resolved_ticket_history table (sync.mjs upserts into it), not in
  // this file. This file previously tried to "append to the existing
  // cache" for incremental runs, which silently did nothing in CI since
  // cache/ is gitignored and every checkout starts empty.
  const history = await fetchHistory({ sinceIso: historyWatermark, limit: historyWatermark ? undefined : 500 });
  writeJsonl(path.join(CACHE_DIR, "history.raw.jsonl"), history);

  return { trackedSprints, issueCount: issues.length, epicCount: epics.length, historyCount: history.length };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  fetchAll().then((summary) => console.log("Fetched:", summary)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
