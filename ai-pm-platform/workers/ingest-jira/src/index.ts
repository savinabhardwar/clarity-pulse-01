import { normalizeJiraIssue, type JiraIssue, type QueuedEvent } from "@ai-pm-platform/core";

interface Env {
  EVENTS_QUEUE: Queue<QueuedEvent>;
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Shared secret so this HTTP-triggered poll endpoint isn't wide open --
  // it causes real Jira API calls and real Queue writes. Not a webhook
  // signature (there's no inbound webhook here, Jira isn't pushing
  // anything to us) -- a plain shared secret is the right tool for "only
  // our own scheduler may call this," task 3.2's HMAC verification is
  // for a different problem (untrusted third-party senders).
  INGEST_TRIGGER_SECRET: string;
}

interface TrackedProject {
  id: string;
  jira_project_key: string;
}

async function fetchTrackedProjects(env: Env): Promise<TrackedProject[]> {
  const url = `${env.SUPABASE_URL}/rest/v1/projects?select=id,jira_project_key&jira_project_key=not.is.null`;
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

// Polling, not webhooks (docs/discovery.md §0.2: confirmed live, zero
// Jira webhooks configured). windowMinutes is a fixed trailing window,
// not a persisted cursor -- refining this into proper cursor tracking
// (catching up correctly after downtime longer than the window) is task
// 3.4/3.6's job, not built here; this task's scope is "one Worker per
// source" existing and working, not the full incremental-poll design.
async function fetchUpdatedIssues(
  env: Env,
  projectKeys: string[],
  windowMinutes: number,
): Promise<JiraIssue[]> {
  if (projectKeys.length === 0) return [];
  const jql = `project in (${projectKeys.join(",")}) AND updated >= -${windowMinutes}m ORDER BY updated ASC`;
  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);
  const fields = ["project", "summary", "status", "issuetype", "updated", "created", "assignee"];
  const url = `${env.JIRA_BASE_URL}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields.join(",")}&maxResults=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { issues: JiraIssue[] };
  return body.issues;
}

export async function pollAndEnqueue(env: Env, windowMinutes = 10): Promise<{ enqueued: number }> {
  const projects = await fetchTrackedProjects(env);
  const byKey = new Map(projects.map((p) => [p.jira_project_key, p.id]));
  const issues = await fetchUpdatedIssues(env, [...byKey.keys()], windowMinutes);

  let enqueued = 0;
  for (const issue of issues) {
    const projectId = byKey.get(issue.fields.project.key);
    if (!projectId) continue; // shouldn't happen: JQL already scoped to tracked keys
    const event = normalizeJiraIssue(issue);
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
