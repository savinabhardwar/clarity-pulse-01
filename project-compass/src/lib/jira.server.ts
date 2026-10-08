// Server-only Jira REST helpers (credentials come from process.env and are
// never sent to the browser). Mirrors the calling convention of
// src/actions/find-jira-match.ts and scripts/jira-sync/fetch-jira-rest.mjs.

interface JiraHttpError extends Error {
  status?: number;
}

function authHeader(): string {
  const email = process.env["JIRA_EMAIL"];
  const token = process.env["JIRA_API_TOKEN"];
  if (!email || !token) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

function baseUrl(): string {
  const base = process.env["JIRA_BASE_URL"];
  if (!base) throw new Error("JIRA_BASE_URL not set");
  return base.replace(/\/$/, "");
}

// Retry only 429 (rate limited) and >=500 (transient); a 400/401/403/404 will
// never succeed on retry, so it fails fast.
function isRetryable(err: unknown): boolean {
  const status = (err as JiraHttpError)?.status ?? 0;
  return status === 429 || status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

// Jira's error bodies are JSON ({"errorMessages":[...],"errors":{...}}); reduce
// them to plain text so they read well in a toast.
function readableJiraError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    const parts = [...(parsed.errorMessages ?? []), ...Object.values(parsed.errors ?? {})];
    if (parts.length > 0) return parts.join("; ");
  } catch {
    // not JSON -- fall through to the raw text
  }
  return body.slice(0, 300);
}

async function jiraRequest(path: string, init?: RequestInit): Promise<Response> {
  return withRetry(async () => {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) {
      const err: JiraHttpError = new Error(
        `Jira ${res.status}: ${readableJiraError(await res.text())}`,
      );
      err.status = res.status;
      throw err;
    }
    return res;
  });
}

// A stored link's jira_key is whatever was pasted into the form, so it can
// carry URL junk (e.g. "CX-342?atlOrigin=..."). Reduce it to the bare key.
export function cleanJiraKey(raw: string): string | null {
  return raw.match(/^[A-Z][A-Z0-9_]*-\d+/i)?.[0].toUpperCase() ?? null;
}

interface JiraTransition {
  id: string;
  to?: { name?: string };
}

// Pure so it can be reasoned about on its own: the transitions that land the
// ticket in a status literally named "Done". Matching by name (not by status
// category) deliberately excludes "Can't Do"/"Not Successful"-style terminal
// statuses that some workflows file under a done-ish category. A ticket can
// offer more than one (ACX's Testing status has a global and a status-specific
// "Done" with different validators), hence a list.
export function pickDoneTransitions(transitions: JiraTransition[]): JiraTransition[] {
  return transitions.filter((t) => t.to?.name?.trim().toLowerCase() === "done");
}

export type TransitionOutcome = "transitioned" | "already-done";

// Moves one Jira ticket to Done through its own workflow, trying each
// transition to Done that the ticket's current status offers until one is
// accepted. Throws if there is none, or if the workflow refuses all of them.
export async function transitionIssueToDone(key: string): Promise<TransitionOutcome> {
  const issueRes = await jiraRequest(`/rest/api/3/issue/${key}?fields=status`);
  const issue = (await issueRes.json()) as { fields?: { status?: { name?: string } } };
  const status = issue.fields?.status;
  if (status?.name?.trim().toLowerCase() === "done") return "already-done";

  const transRes = await jiraRequest(`/rest/api/3/issue/${key}/transitions`);
  const { transitions = [] } = (await transRes.json()) as { transitions?: JiraTransition[] };
  const candidates = pickDoneTransitions(transitions);
  if (candidates.length === 0) {
    throw new Error(`no transition to Done from "${status?.name ?? "current status"}"`);
  }

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      await jiraRequest(`/rest/api/3/issue/${key}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: candidate.id } }),
      });
      return "transitioned";
    } catch (err) {
      // Only a validation refusal is worth trying the next transition for.
      if ((err as JiraHttpError).status !== 400) throw err;
      lastErr = err;
    }
  }
  if (/required field/i.test(String(lastErr))) {
    throw new Error(
      "the workflow needs more fields before Done (e.g. estimate, time spent, comment) — finish it in Jira",
    );
  }
  throw lastErr;
}
