import type { NormalizedEvent } from "../event.ts";

// Shape of what /rest/api/3/search/jql returns per issue -- verified
// against a real live fetch (ai-pm-platform/db/seed/fixtures/jira-issue.json,
// LT-43), not guessed. Only the fields this normalizer actually reads are
// typed; Jira issues carry far more than this.
export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    project: { key: string };
    summary: string;
    status: { name: string; id: string };
    issuetype: { name: string };
    updated: string;
    created: string;
    assignee: { accountId: string } | null;
  };
}

// Ingestion mode is polling, not webhooks (docs/event-contracts.md,
// docs/discovery.md §0.2 -- confirmed live 2026-09-18, zero webhooks
// configured). A poll returns current state, not a delivered event, so
// this normalizes ONE polled snapshot into ONE normalized "observed"
// event. It deliberately does NOT try to infer what changed (status
// transition, comment, reassignment) -- that requires diffing against
// previously-seen state, which is I/O (a DB read), which task 3.1's own
// Check rules out for a normalizer ("pure functions, no I/O"). Turning
// this into a specific event_type (e.g. "status_changed") is the ingest
// Worker's job (task 3.3+), not this function's.
//
// Dedup key: issue.id + fields.updated, per event-contracts.md's own
// documented reasoning (mirrors fetch-jira-rest.mjs's existing cursor
// logic, which cursors on `updated` specifically because `resolutiondate`
// is frequently null on exactly the tickets that need catching).
export function normalizeJiraIssue(issue: JiraIssue): NormalizedEvent {
  return {
    source: "jira",
    eventType: "issue.observed",
    projectHint: issue.fields.project.key,
    entityType: "issue",
    entityId: issue.key,
    actor: issue.fields.assignee ? { type: "user", id: issue.fields.assignee.accountId } : null,
    timestamp: issue.fields.updated,
    payload: issue,
    correlationId: null,
    providerEventId: `${issue.id}:${issue.fields.updated}`,
  };
}
