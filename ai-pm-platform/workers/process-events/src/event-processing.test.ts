import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertEvent, updateStateTable, processMessage } from "./event-processing.ts";
import type { QueuedEvent } from "@ai-pm-platform/core";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(r?.body ?? []), { status: r?.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const config = { supabaseUrl: "https://example.supabase.co", serviceRoleKey: "test-key" };

const jiraEvent: QueuedEvent = {
  source: "jira",
  eventType: "issue.observed",
  projectHint: "LT",
  projectId: "proj-1",
  entityType: "issue",
  entityId: "LT-43",
  actor: null,
  timestamp: "2026-09-24T00:00:00Z",
  payload: {
    id: "43703",
    key: "LT-43",
    fields: {
      project: { key: "LT" },
      summary: "Test issue",
      status: { name: "In Progress", id: "3" },
      issuetype: { name: "Story" },
      updated: "2026-09-24T00:00:00Z",
      created: "2026-09-20T00:00:00Z",
      assignee: null,
    },
  },
  correlationId: null,
  providerEventId: "43703:2026-09-24T00:00:00Z",
};

test("upsertEvent returns true for a genuinely new event", async () => {
  const { fetchImpl } = mockFetch([{ status: 201, body: [{ id: "event-row-1" }] }]);
  const isNew = await upsertEvent(jiraEvent, { ...config, fetchImpl });
  assert.equal(isNew, true);
});

test("upsertEvent returns false for a duplicate (ignore-duplicates -> empty array, not an error)", async () => {
  const { fetchImpl } = mockFetch([{ status: 201, body: [] }]);
  const isNew = await upsertEvent(jiraEvent, { ...config, fetchImpl });
  assert.equal(isNew, false);
});

test("upsertEvent throws on a real failure rather than treating it as a duplicate", async () => {
  const { fetchImpl } = mockFetch([{ status: 500, body: { message: "boom" } }]);
  await assert.rejects(() => upsertEvent(jiraEvent, { ...config, fetchImpl }));
});

test("updateStateTable dispatches a Jira issue.observed event to the issues upsert", async () => {
  const { fetchImpl, calls } = mockFetch([{ status: 201, body: [{}] }]);
  await updateStateTable(jiraEvent, { ...config, fetchImpl });
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /\/rest\/v1\/issues\?on_conflict=jira_issue_key/);
  assert.equal((calls[0]?.body as { jira_issue_key: string }).jira_issue_key, "LT-43");
});

test("updateStateTable dispatches a pull_request event via the startsWith fallback", async () => {
  const prEvent: QueuedEvent = {
    ...jiraEvent,
    source: "github",
    eventType: "pull_request.merged",
    payload: {
      number: 128,
      title: "Test PR",
      merged: true,
      merged_at: "2026-09-24T00:00:00Z",
      created_at: "2026-09-23T00:00:00Z",
      updated_at: "2026-09-24T00:00:00Z",
      user: { login: "tester" },
    },
  };
  const { fetchImpl, calls } = mockFetch([{ status: 201, body: [{}] }]);
  await updateStateTable(prEvent, { ...config, fetchImpl });
  assert.match(
    calls[0]?.url ?? "",
    /\/rest\/v1\/pull_requests\?on_conflict=repository,external_pr_id/,
  );
});

test("updateStateTable is a no-op for an unrecognized event type, not an error", async () => {
  const unknownEvent: QueuedEvent = {
    ...jiraEvent,
    source: "jira",
    eventType: "some.future.event",
  };
  const { fetchImpl, calls } = mockFetch([]);
  await updateStateTable(unknownEvent, { ...config, fetchImpl });
  assert.equal(calls.length, 0);
});

test("processMessage skips the state-table update for a duplicate event", async () => {
  const { fetchImpl, calls } = mockFetch([{ status: 201, body: [] }]); // events insert reports duplicate
  await processMessage(jiraEvent, { ...config, fetchImpl });
  assert.equal(calls.length, 1); // only the events upsert call, no issues upsert followed it
});

test("processMessage updates the state table for a genuinely new event", async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 201, body: [{ id: "event-row-1" }] }, // events insert: new
    { status: 201, body: [{}] }, // issues upsert
  ]);
  await processMessage(jiraEvent, { ...config, fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.url ?? "", /\/rest\/v1\/issues/);
});
