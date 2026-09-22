import { test } from "node:test";
import assert from "node:assert/strict";
import { pollAndEnqueue } from "./index.ts";

function fakeQueue() {
  const sent: unknown[] = [];
  return { sent, send: async (msg: unknown) => void sent.push(msg) };
}

function fakeEnv(overrides: {
  trackedProjects: Array<{ id: string; requirements_project_id: string }>;
  items: Array<Record<string, unknown>>;
}) {
  const queue = fakeQueue();
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/rest/v1/projects")) {
      return new Response(JSON.stringify(overrides.trackedProjects), { status: 200 });
    }
    if (u.includes("/rest/v1/stakeholder_items")) {
      return new Response(JSON.stringify(overrides.items), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;

  return {
    env: {
      EVENTS_QUEUE: queue,
      REQUIREMENTS_APP_SUPABASE_URL: "https://project-compass.example.supabase.co",
      REQUIREMENTS_APP_SUPABASE_KEY: "fake-key",
      SUPABASE_URL: "https://ai-pm-platform.example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
      INGEST_TRIGGER_SECRET: "fake-trigger-secret",
    },
    queue,
    fetchImpl,
  };
}

test("polls tracked projects, normalizes, and enqueues matching items", async () => {
  const { env, queue, fetchImpl } = fakeEnv({
    trackedProjects: [{ id: "internal-proj-1", requirements_project_id: "compass-proj-1" }],
    items: [
      {
        id: "item-1",
        project_id: "compass-proj-1",
        summary: "Add CSV export",
        status: "In Progress",
        jira_key: "LT-43",
        created_by: "pm@example.com",
        updated_at: "2026-09-22T09:00:00Z",
      },
    ],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    // @ts-expect-error -- Env in index.ts expects Cloudflare's Queue type; the fake queue here only implements .send, which is all pollAndEnqueue actually calls.
    const result = await pollAndEnqueue(env);
    assert.equal(result.enqueued, 1);
    assert.equal(queue.sent.length, 1);
    assert.deepEqual((queue.sent[0] as { entityId: string }).entityId, "item-1");
    assert.deepEqual((queue.sent[0] as { projectId: string }).projectId, "internal-proj-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns 0 enqueued when no projects are tracked, without querying project-compass", async () => {
  const { env, fetchImpl } = fakeEnv({ trackedProjects: [], items: [] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    // @ts-expect-error -- see note above
    const result = await pollAndEnqueue(env);
    assert.equal(result.enqueued, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
