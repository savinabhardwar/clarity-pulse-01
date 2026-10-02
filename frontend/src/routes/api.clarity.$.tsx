import { createFileRoute } from "@tanstack/react-router";
import { backendRequest } from "@/lib/backend.server";

async function proxy(request: Request, path: string): Promise<Response> {
  if (
    !/^(people|projects|allocations|project-contributors|org-metrics|standouts|blockers|ticket-hygiene|recent-activity|top-risks|sprint-overrun-count|tracked-sprint-status|teams)(\/[A-Za-z0-9_-]+)*$/.test(
      path,
    )
  ) {
    return Response.json({ detail: "Unknown API route" }, { status: 404 });
  }
  try {
    const response = await backendRequest(`/api/${path}${new URL(request.url).search}`);
    return new Response(await response.arrayBuffer(), {
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
      POST: () => Response.json({ detail: "Method not allowed" }, { status: 405 }),
      PUT: () => Response.json({ detail: "Method not allowed" }, { status: 405 }),
      PATCH: () => Response.json({ detail: "Method not allowed" }, { status: 405 }),
      DELETE: () => Response.json({ detail: "Method not allowed" }, { status: 405 }),
    },
  },
});
