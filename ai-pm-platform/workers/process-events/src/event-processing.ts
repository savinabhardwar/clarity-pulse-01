import type {
  QueuedEvent,
  JiraIssue,
  GithubPullRequestPayload,
  StakeholderItem,
} from "@ai-pm-platform/core";

export interface ProcessConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl: typeof fetch;
}

function headers(config: ProcessConfig) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Inserts into the append-only `events` log, deduped on
 * (source, provider_event_id) via PostgREST's upsert +
 * ignore-duplicates -- returns false if this event was already recorded
 * (a real duplicate, not an error), true if this is genuinely new.
 * Duplicates can come from either source (CLAUDE.md hard rule 4): the
 * provider retrying its own webhook, or Cloudflare Queues' at-least-once
 * redelivery -- this dedup layer doesn't care which caused the repeat.
 */
export async function upsertEvent(event: QueuedEvent, config: ProcessConfig): Promise<boolean> {
  const url = `${config.supabaseUrl}/rest/v1/events?on_conflict=source,provider_event_id`;
  const res = await config.fetchImpl(url, {
    method: "POST",
    headers: {
      ...headers(config),
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify({
      source: event.source,
      event_type: event.eventType,
      project_id: event.projectId,
      entity_type: event.entityType,
      entity_id: event.entityId,
      actor_type: event.actor?.type ?? null,
      actor_id: event.actor?.id ?? null,
      timestamp: event.timestamp,
      payload: event.payload,
      correlation_id: event.correlationId,
      provider_event_id: event.providerEventId,
    }),
  });
  if (!res.ok) {
    throw new Error(`events insert failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

// Person-identity resolution (Jira accountId / GitHub username /
// stakeholder created_by free text -> our internal users.id) is
// deliberately NOT done here. Four different identity spaces, no unified
// matching strategy has been decided (CLAUDE.md rule 2: don't guess a
// contract) -- assignee_id/author_id/created_by are left null rather than
// guessing a heuristic match. A real open question, not an oversight.

async function upsertIssue(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  const issue = event.payload as JiraIssue;
  const url = `${config.supabaseUrl}/rest/v1/issues?on_conflict=jira_issue_key`;
  const res = await config.fetchImpl(url, {
    method: "POST",
    headers: { ...headers(config), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      project_id: event.projectId,
      jira_issue_key: issue.key,
      jira_issue_id: issue.id,
      title: issue.fields.summary,
      issue_type: issue.fields.issuetype.name,
      status: issue.fields.status.name,
    }),
  });
  if (!res.ok) throw new Error(`issues upsert failed: ${res.status} ${await res.text()}`);
}

async function upsertCommit(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  const commit = event.payload as { id: string; message: string; timestamp: string };
  const url = `${config.supabaseUrl}/rest/v1/commits?on_conflict=repository,commit_hash`;
  const res = await config.fetchImpl(url, {
    method: "POST",
    headers: { ...headers(config), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      project_id: event.projectId,
      repository: event.projectHint,
      commit_hash: commit.id,
      message: commit.message,
      committed_at: commit.timestamp,
    }),
  });
  if (!res.ok) throw new Error(`commits upsert failed: ${res.status} ${await res.text()}`);
}

async function upsertPullRequest(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  const pr = event.payload as GithubPullRequestPayload["pull_request"];
  const url = `${config.supabaseUrl}/rest/v1/pull_requests?on_conflict=repository,external_pr_id`;
  const res = await config.fetchImpl(url, {
    method: "POST",
    headers: { ...headers(config), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      project_id: event.projectId,
      repository: event.projectHint,
      external_pr_id: String(pr.number),
      title: pr.title,
      status: pr.merged ? "merged" : "open",
      created_at: pr.created_at,
      merged_at: pr.merged_at,
    }),
  });
  if (!res.ok) throw new Error(`pull_requests upsert failed: ${res.status} ${await res.text()}`);
}

async function upsertRequirement(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  const item = event.payload as StakeholderItem;
  const url = `${config.supabaseUrl}/rest/v1/requirements?on_conflict=source_reference`;
  const res = await config.fetchImpl(url, {
    method: "POST",
    headers: { ...headers(config), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      project_id: event.projectId,
      source_reference: item.id,
      title: item.summary,
      status: item.status,
    }),
  });
  if (!res.ok) throw new Error(`requirements upsert failed: ${res.status} ${await res.text()}`);
}

/**
 * CLAUDE.md §8/task 2.1: keep the Twin compact -- normalized rows, not
 * raw payload dumps. The full raw payload already lives on the `events`
 * row (upsertEvent above); this only writes the compact fields each
 * state table actually has.
 */
export async function updateStateTable(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  switch (`${event.source}:${event.eventType}`) {
    case "jira:issue.observed":
      return upsertIssue(event, config);
    case "github:commit.pushed":
      return upsertCommit(event, config);
    case "requirements-app:requirement.observed":
      return upsertRequirement(event, config);
    default:
      if (event.source === "github" && event.eventType.startsWith("pull_request.")) {
        return upsertPullRequest(event, config);
      }
      // Unknown event type: recorded on `events` already (upsertEvent),
      // just nothing to mirror into a state table. Not an error.
      return;
  }
}

// TODO Phase 4: hand off the processed event to the Policy Engine once it
// exists (task 3.3's original wording). No-op today -- there is nothing
// to hand off to yet, and CLAUDE.md's single most important rule (the LLM
// and any automation never execute directly off an event) means this
// can't be stubbed with a fake call either.
export async function processMessage(event: QueuedEvent, config: ProcessConfig): Promise<void> {
  const isNew = await upsertEvent(event, config);
  if (!isNew) return; // genuine duplicate, already fully processed before
  await updateStateTable(event, config);
}
