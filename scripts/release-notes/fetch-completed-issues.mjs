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

// Link types that don't imply "the other half of this feature isn't
// done" -- a duplicate or a clone is a bookkeeping relationship, not a
// dependency. Everything else (Blocks, Relates, "split to/from", etc.)
// counts, because a feature's frontend/backend/design work is often
// split across tickets connected by a weak "Relates to" link rather than
// a formal "Blocks" -- e.g. CX Omni's "Form Node" and "FE Form Node"
// tickets (confirmed 2026-09-23: this is exactly the shape that slipped
// through when only "Blocks" was checked).
const LINK_TYPES_IGNORED_FOR_COMPLETENESS = new Set(["Duplicate", "Cloners"]);

// An issue that is Done but still has an incomplete subtask, or has ANY
// linked issue that isn't Done (not just a formal "Blocks" link), is not
// actually finished from a feature standpoint even though its own status
// says so. This is computed here, deterministically, from real Jira
// data -- not left for the LLM to infer from a ticket summary (CLAUDE.md
// hard rule 5).
function completenessNote(issue) {
  const notes = [];

  const openSubtasks = (issue.fields.subtasks ?? []).filter(
    (st) => st.fields.status?.statusCategory?.key !== "done",
  );
  if (openSubtasks.length > 0) {
    notes.push(`pending subtask(s): ${openSubtasks.map((st) => st.key).join(", ")}`);
  }

  const openLinked = [];
  for (const link of issue.fields.issuelinks ?? []) {
    if (LINK_TYPES_IGNORED_FOR_COMPLETENESS.has(link.type?.name)) continue;
    const other = link.inwardIssue ?? link.outwardIssue;
    if (!other) continue;
    const relation = link.inwardIssue ? link.type?.inward : link.type?.outward;
    if (other.fields?.status?.statusCategory?.key !== "done") {
      openLinked.push(`${relation ?? "linked to"} ${other.key} (still open)`);
    }
  }
  if (openLinked.length > 0) {
    notes.push(openLinked.join("; "));
  }

  return notes.length > 0 ? notes.join("; ") : null;
}

export async function fetchCompletedIssues({ jiraKey, since, until }) {
  // "QAlity Test" is a dedicated issue type on this instance for QA test
  // cases themselves (not features) -- excluded deterministically here
  // since it's a clean structured signal. Everything else that reads as
  // "testing" or "infra" work (e.g. "Gamification Automation Testing",
  // "Migrate to SQLAlchemy") is a Story/Task/Bug like any other, with no
  // reliable field to filter on in this instance -- that's left to the
  // prompt in summarize.mjs, which excludes it as "not a user-visible
  // capability" the same way it already excludes non-shipped work.
  const jql = `project = ${jiraKey} AND statusCategory = Done AND issuetype != "QAlity Test" AND updated >= "${since}" AND updated <= "${until}" ORDER BY updated ASC`;
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
