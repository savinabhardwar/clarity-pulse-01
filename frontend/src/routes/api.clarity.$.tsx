import { createFileRoute } from "@tanstack/react-router";
import { backendRequest } from "@/lib/backend.server";

const reads =
  /^(people|projects|allocations|project-contributors|org-metrics|standouts|blockers|ticket-hygiene|recent-activity|top-risks|sprint-overrun-count|tracked-sprint-status|teams|tracked-sprints|adjustments|open-tickets|sprint-done-tickets|worklog-ticket-ids|sprint-worklogs|all-worklogs|person-history|planning-availability|next-sprint-tickets|canonical-sprint|team-sprint-summaries|org-sprint-summaries)(\/[A-Za-z0-9_-]+)?$/;

async function proxy(request: Request, path: string): Promise<Response> {
  const method = request.method;
  const allowed =
    method === "GET"
      ? reads.test(path)
      : method === "POST"
        ? ["planning-availability", "jira-sync"].includes(path)
        : ["PATCH", "DELETE"].includes(method) && /^planning-availability\/[0-9a-f-]+$/i.test(path);
  if (!allowed)
    return Response.json(
      { detail: "Method or route not allowed" },
      { status: method === "GET" ? 404 : 405 },
    );
  if (method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json({ detail: "Invalid request origin" }, { status: 403 });
  }
  try {
    const response = await backendRequest(`/api/${path}${new URL(request.url).search}`, {
      method,
      ...(method === "GET"
        ? {}
        : { body: await request.text(), headers: { "Content-Type": "application/json" } }),
    });
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json({ detail: "The ClarityPulse backend is unavailable" }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/clarity/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, params._splat ?? ""),
      POST: ({ request, params }) => proxy(request, params._splat ?? ""),
      PATCH: ({ request, params }) => proxy(request, params._splat ?? ""),
      DELETE: ({ request, params }) => proxy(request, params._splat ?? ""),
      PUT: () => Response.json({ detail: "Method not allowed" }, { status: 405 }),
    },
  },
});
