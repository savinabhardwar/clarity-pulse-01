import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";
import type { QueuedEvent } from "@ai-pm-platform/core";

function fakeMessage(id: string, body: QueuedEvent, attempts = 1) {
  const acked: boolean[] = [];
  const retried: Array<{ delaySeconds?: number }> = [];
  return {
    id,
    body,
    attempts,
    ack: () => acked.push(true),
    retry: (opts?: { delaySeconds?: number }) => retried.push(opts ?? {}),
    acked,
    retried,
  };
}

const validEvent: QueuedEvent = {
  source: "requirements-app",
  eventType: "requirement.observed",
  projectHint: "some-project",
  projectId: "proj-1",
  entityType: "requirement",
  entityId: "item-1",
  actor: null,
  timestamp: "2026-09-24T00:00:00Z",
  payload: {
    id: "item-1",
    project_id: "some-project",
    summary: "Test",
    status: "To Do",
    created_by: null,
    updated_at: "2026-09-24T00:00:00Z",
  },
  correlationId: null,
  providerEventId: "item-1:2026-09-24T00:00:00Z",
};

test("a malformed message retries individually without crash-looping the rest of the batch", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    // First call (the malformed message's events-insert) fails; every
    // other call (the valid messages) succeeds as a fresh insert.
    if (callCount === 1) {
      return new Response(JSON.stringify({ message: "malformed payload" }), { status: 400 });
    }
    return new Response(JSON.stringify([{ id: "row" }]), { status: 201 });
  }) as unknown as typeof fetch;

  try {
    // @ts-expect-error -- payload deliberately missing required fields to trigger a real processing failure
    const malformed = fakeMessage("msg-bad", { source: "jira" }, 1);
    const good1 = fakeMessage("msg-good-1", validEvent, 1);
    const good2 = fakeMessage(
      "msg-good-2",
      { ...validEvent, entityId: "item-2", providerEventId: "item-2:x" },
      1,
    );

    const batch = { messages: [malformed, good1, good2] };
    // @ts-expect-error -- fake batch/messages only implement what the handler actually uses (id, body, attempts, ack, retry)
    await worker.queue(batch, {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    });

    assert.equal(
      malformed.retried.length,
      1,
      "malformed message should retry, not crash the handler",
    );
    assert.equal(malformed.acked.length, 0);
    assert.equal(
      good1.acked.length,
      1,
      "a valid message alongside a bad one should still be acked",
    );
    assert.equal(
      good2.acked.length,
      1,
      "processing continues past the bad message to the rest of the batch",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
