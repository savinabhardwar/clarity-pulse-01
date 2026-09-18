// Same auth/pagination pattern as scripts/jira-sync/fetch-jira-rest.mjs's
// jiraSearch(). This Jira instance doesn't populate `resolutiondate` on
// Done issues (confirmed 2026-09-11 against QIP -- every Done issue came
// back with resolutiondate: null), so `updated` on a Done-status issue is
// used as the completion-date proxy, same as the manual QIP release
// notes this automation is modeled on.
import { withRetry, isRetryableHttpStatus } from "../jira-sync/lib/retry.mjs";

const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

function authHeader() {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

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
    {
      label: `Jira search (jql=${jql.slice(0, 60)}...)`,
      isRetryable: (err) => isRetryableHttpStatus(err.status),
    },
  );
}

// A "Blocks" link's inward side reads "is blocked by" (confirmed against
// getIssueLinkTypes on this instance -- id 10000, inward: "is blocked by",
// outward: "blocks"). An issue that is Done but still has an incomplete
// subtask, or is blocked by an issue that isn't Done, is not actually
// finished from a feature standpoint even though its own status says so.
// This is computed here, deterministically, from real Jira data -- not
// left for the LLM to infer from a ticket summary (CLAUDE.md hard rule 5).
function completenessNote(issue) {
  const notes = [];

  const openSubtasks = (issue.fields.subtasks ?? []).filter(
    (st) => st.fields.status?.statusCategory?.key !== "done",
  );
  if (openSubtasks.length > 0) {
    notes.push(`pending subtask(s): ${openSubtasks.map((st) => st.key).join(", ")}`);
  }

  const openBlockers = (issue.fields.issuelinks ?? [])
    .filter((link) => link.type?.name === "Blocks" && link.inwardIssue)
    .filter((link) => link.inwardIssue.fields.status?.statusCategory?.key !== "done")
    .map((link) => link.inwardIssue.key);
  if (openBlockers.length > 0) {
    notes.push(`blocked by ${openBlockers.join(", ")} (still open)`);
  }

  return notes.length > 0 ? notes.join("; ") : null;
}

export async function fetchCompletedIssues({ jiraKey, since, until }) {
  const jql = `project = ${jiraKey} AND statusCategory = Done AND updated >= "${since}" AND updated <= "${until}" ORDER BY updated ASC`;
  const results = [];
  let nextPageToken;
  do {
    const body = await jiraSearchPage({
      jql,
      fields: ["summary", "issuetype", "assignee", "updated", "subtasks", "issuelinks"],
      maxResults: 100,
      nextPageToken,
    });
    results.push(...body.issues);
    nextPageToken = body.nextPageToken;
  } while (nextPageToken);

  return results.map((issue) => ({
    key: issue.key,
    issuetype: issue.fields.issuetype?.name,
    summary: issue.fields.summary,
    assignee: issue.fields.assignee?.displayName ?? null,
    updated: issue.fields.updated,
    completenessNote: completenessNote(issue),
  }));
}
