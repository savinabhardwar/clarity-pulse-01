// NOT DEPLOYED as of 2026-09-22. This platform has no working credential
// for project-compass's separate Supabase project yet -- docs/discovery.md
// §0.3: write access was AGREED, but no credential (not even read) has
// actually been issued. Deploying a Worker whose only real invocation
// would immediately fail isn't useful verification, so this ships as
// reviewed, typechecked, unit-tested code (mocked fetch, same pattern as
// packages/core/src/project-resolution.test.ts), not a live deployment.
// CLAUDE.md §7: "A credential... is needed" is an explicit stop-and-ask
// trigger -- ask the human for REQUIREMENTS_APP_SUPABASE_URL and a key
// before this can go live.
import {
  normalizeStakeholderItem,
  type StakeholderItem,
  type QueuedEvent,
} from "@ai-pm-platform/core";

interface Env {
  EVENTS_QUEUE: Queue<QueuedEvent>;
  REQUIREMENTS_APP_SUPABASE_URL: string;
  REQUIREMENTS_APP_SUPABASE_KEY: string; // anon+RLS or service_role -- not yet decided, see docs/discovery.md §0.3
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  INGEST_TRIGGER_SECRET: string;
}

interface TrackedProject {
  id: string;
  requirements_project_id: string;
}

async function fetchTrackedProjects(env: Env): Promise<TrackedProject[]> {
  const url = `${env.SUPABASE_URL}/rest/v1/projects?select=id,requirements_project_id&requirements_project_id=not.is.null`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok)
    throw new Error(`Failed to fetch tracked projects: ${res.status} ${await res.text()}`);
  return (await res.json()) as TrackedProject[];
}

// Polling, not webhooks -- project-compass emits no events of its own at
// all (docs/event-contracts.md: "None -- confirmed"). Same fixed-window
// caveat as ingest-jira: proper cursor tracking is task 3.4/3.6's job.
async function fetchUpdatedItems(
  env: Env,
  projectIds: string[],
  windowMinutes: number,
): Promise<StakeholderItem[]> {
  if (projectIds.length === 0) return [];
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const idList = projectIds.map((id) => `"${id}"`).join(",");
  const url = `${env.REQUIREMENTS_APP_SUPABASE_URL}/rest/v1/stakeholder_items?select=id,project_id,summary,status,jira_key,created_by,updated_at&project_id=in.(${idList})&updated_at=gte.${since}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.REQUIREMENTS_APP_SUPABASE_KEY,
      Authorization: `Bearer ${env.REQUIREMENTS_APP_SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`project-compass query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as StakeholderItem[];
}

export async function pollAndEnqueue(env: Env, windowMinutes = 10): Promise<{ enqueued: number }> {
  const projects = await fetchTrackedProjects(env);
  const byId = new Map(projects.map((p) => [p.requirements_project_id, p.id]));
  const items = await fetchUpdatedItems(env, [...byId.keys()], windowMinutes);

  let enqueued = 0;
  for (const item of items) {
    const projectId = item.project_id ? byId.get(item.project_id) : undefined;
    if (!projectId) continue; // shouldn't happen: query already scoped to tracked ids
    const event = normalizeStakeholderItem(item);
    if (!event) continue; // null project_id case, already excluded above, kept for type-safety
    const queued: QueuedEvent = { ...event, projectId };
    await env.EVENTS_QUEUE.send(queued);
    enqueued += 1;
  }
  return { enqueued };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const trigger = request.headers.get("X-Ingest-Trigger-Secret");
    if (trigger !== env.INGEST_TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    try {
      const windowParam = new URL(request.url).searchParams.get("windowMinutes");
      const windowMinutes = windowParam ? Number(windowParam) : undefined;
      const result = await pollAndEnqueue(env, windowMinutes);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(`poll failed: ${(e as Error).message}`, { status: 500 });
    }
  },
};
