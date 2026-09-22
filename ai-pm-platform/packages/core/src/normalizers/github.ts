import type { NormalizedEvent } from "../event.ts";

// GitHub's documented webhook payload shapes (standard product behavior,
// not org-specific -- docs/event-contracts.md gives GitHub's event
// catalog this same treatment). NOT verified against a live delivery
// from alldayPA's repos this session: real API calls against
// alldayPA/line-tester returned 404 -- org access has narrowed since
// Phase 0 (docs/discovery.md documented 431 visible repos; only 3 are
// visible now). See ai-pm-platform/db/seed/fixtures/README.md. Re-verify
// field-for-field against a real captured delivery before task 3.3 ships
// against this normalizer for real.
export interface GithubPushPayload {
  ref: string;
  repository: { full_name: string };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: { username: string; email: string };
  }>;
}

export interface GithubPullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    merged: boolean;
    merged_at: string | null;
    created_at: string;
    updated_at: string;
    user: { login: string };
  };
  repository: { full_name: string };
}

// One push carries N commits -- each becomes its own normalized event
// (they'll each become their own `commits` row, per migration 0002's
// unique (repository, commit_hash)). deliveryId comes from the
// X-GitHub-Delivery header, not the payload body -- passed in explicitly
// rather than guessed at, since GitHub webhook headers are real,
// verified product behavior (docs/discovery.md §0.4), not something a
// normalizer should invent from body content alone.
export function normalizeGithubPush(
  payload: GithubPushPayload,
  deliveryId: string,
): NormalizedEvent[] {
  return payload.commits.map((commit) => ({
    source: "github",
    eventType: "commit.pushed",
    projectHint: payload.repository.full_name,
    entityType: "commit",
    entityId: commit.id,
    actor: { type: "user", id: commit.author.username },
    timestamp: commit.timestamp,
    payload: commit,
    correlationId: deliveryId,
    providerEventId: `${deliveryId}:${commit.id}`,
  }));
}

export function normalizeGithubPullRequest(
  payload: GithubPullRequestPayload,
  deliveryId: string,
): NormalizedEvent {
  const pr = payload.pull_request;
  return {
    source: "github",
    eventType: pr.merged ? "pull_request.merged" : `pull_request.${payload.action}`,
    projectHint: payload.repository.full_name,
    entityType: "pull_request",
    entityId: String(pr.number),
    actor: { type: "user", id: pr.user.login },
    timestamp: pr.updated_at,
    payload: pr,
    correlationId: deliveryId,
    providerEventId: `${deliveryId}:${pr.number}:${payload.action}`,
  };
}
