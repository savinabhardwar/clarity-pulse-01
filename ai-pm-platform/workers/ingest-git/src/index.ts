import {
  verifyWebhookSignature,
  normalizeGithubPush,
  normalizeGithubPullRequest,
  resolveProjectId,
  type GithubPushPayload,
  type GithubPullRequestPayload,
  type NormalizedEvent,
  type QueuedEvent,
} from "@ai-pm-platform/core";

interface Env {
  EVENTS_QUEUE: Queue<QueuedEvent>;
  GITHUB_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Task 3.2: verify before any parsing or DB access -- the raw body
    // text is read once, used for both the signature check and (only if
    // it passes) JSON parsing, since HMAC must run over the exact bytes
    // GitHub signed, not a re-serialized version of them.
    const rawBody = await request.text();
    const signature = request.headers.get("X-Hub-Signature-256");
    const verified = await verifyWebhookSignature(rawBody, env.GITHUB_WEBHOOK_SECRET, signature);
    if (!verified) {
      return new Response("invalid signature", { status: 401 });
    }

    // Real, documented GitHub webhook headers (not guessed):
    // X-GitHub-Event names the payload type, X-GitHub-Delivery is a
    // stable per-delivery id GitHub generates -- used as this ingest
    // path's correlation/dedup input, since it isn't part of the payload
    // body itself.
    const eventType = request.headers.get("X-GitHub-Event");
    const deliveryId = request.headers.get("X-GitHub-Delivery");
    if (!eventType || !deliveryId) {
      return new Response("missing GitHub event headers", { status: 400 });
    }

    // GitHub sends this on webhook creation/test -- standard practice is
    // to accept it and do nothing else.
    if (eventType === "ping") {
      return new Response("pong", { status: 200 });
    }

    let normalized: NormalizedEvent[];
    if (eventType === "push") {
      normalized = normalizeGithubPush(JSON.parse(rawBody) as GithubPushPayload, deliveryId);
    } else if (eventType === "pull_request") {
      normalized = [
        normalizeGithubPullRequest(JSON.parse(rawBody) as GithubPullRequestPayload, deliveryId),
      ];
    } else {
      // Task 3.3's Check: return 2xx for event types we don't act on so
      // GitHub doesn't retry forever, but don't touch the queue.
      return new Response(`ignored event type: ${eventType}`, { status: 200 });
    }

    const resolutionConfig = {
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      // Not `fetchImpl: fetch` -- passing the bare reference loses its
      // `this` binding by the time project-resolution.ts calls it as
      // `config.fetchImpl(...)`, and Workers' runtime throws "Illegal
      // invocation" on that (confirmed live via wrangler tail; Node
      // doesn't have this restriction, so a local repro didn't catch it).
      // An arrow-function wrapper sidesteps the binding issue entirely.
      fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
    };

    for (const event of normalized) {
      const projectId = await resolveProjectId(event.source, event.projectHint, resolutionConfig);
      if (projectId === null) {
        // D24: only configured projects are ingested. Record-and-drop,
        // not an error -- still 2xx below.
        console.log(`ignored: no configured project for ${event.projectHint}`);
        continue;
      }
      const queued: QueuedEvent = { ...event, projectId };
      await env.EVENTS_QUEUE.send(queued);
    }

    return new Response("ok", { status: 200 });
  },
};
