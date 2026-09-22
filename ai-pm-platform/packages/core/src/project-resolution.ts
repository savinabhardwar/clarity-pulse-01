// Resolves a normalizer's raw `projectHint` (Jira project key, "owner/repo",
// or project-compass's own project uuid) to our internal projects.id.
// This is real I/O -- unlike the pure normalizers, it needs a network call
// -- so `fetchImpl` is injected rather than imported, keeping this testable
// with a mock instead of a live Supabase project. Uses Supabase's REST API
// (PostgREST) via fetch with the service_role key, not a raw Postgres TCP
// client: Cloudflare Workers don't reliably support long-lived TCP sockets
// for Postgres, and CLAUDE.md's "the ingest Worker does not touch Postgres
// directly" (task 3.3) reads naturally as "no direct INSERT/UPDATE", not as
// forbidding this one read -- resolving the project a message belongs to
// has to happen before it can be queued at all.
export interface ProjectResolutionConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl: typeof fetch;
}

const HINT_COLUMN: Record<string, string> = {
  jira: "jira_project_key",
  github: "git_repository",
  "requirements-app": "requirements_project_id",
};

/**
 * Returns the internal projects.id for a given source + hint, or null if
 * no configured project matches (D24: only configured projects are
 * ingested -- the caller should record-and-drop, per task 3.3's Check,
 * not treat this as an error).
 */
export async function resolveProjectId(
  source: string,
  projectHint: string,
  config: ProjectResolutionConfig,
): Promise<string | null> {
  const column = HINT_COLUMN[source];
  if (!column) return null;

  const url = `${config.supabaseUrl}/rest/v1/projects?select=id&${column}=eq.${encodeURIComponent(projectHint)}&limit=1`;
  const res = await config.fetchImpl(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Project resolution query failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}
