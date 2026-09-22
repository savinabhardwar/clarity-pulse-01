// The normalizer's pure output shape. Deliberately NOT identical to the
// `events` table (ai-pm-platform/db/migrations/0001_mvp_tables.sql):
// `projectHint` stands in for `project_id` here, because resolving a raw
// Jira project key / repo name to our internal project uuid is a database
// lookup -- the "resolve project" step task 3.3 names as separate from
// "normalize". A normalizer takes one payload in, returns event shape(s)
// out, no I/O (task 3.1's own Check).
export interface NormalizedEvent {
  source: "jira" | "github" | "requirements-app";
  eventType: string;
  projectHint: string; // e.g. Jira project key, or "owner/repo"
  entityType: string;
  entityId: string;
  actor: { type: "user" | "system"; id: string } | null;
  timestamp: string; // ISO 8601
  payload: unknown; // kept for the events.payload jsonb column only (CLAUDE.md hard rule 8) -- never copied into a compact state table
  correlationId: string | null;
  providerEventId: string; // events.provider_event_id, the dedup key
}
