import { createServerFn } from "@tanstack/react-start";
import { normalize, similarity } from "@/lib/similarity";

// Server-only: finds real Jira tickets whose summary is likely to match a
// user-typed Feature/Implementation summary, so the UI can offer to
// auto-fill the Jira ticket link field. Calls the real Jira REST API
// (mirrors scripts/jira-sync/fetch-jira-rest.mjs's calling convention) --
// credentials (JIRA_EMAIL / JIRA_API_TOKEN) are read from process.env here
// and never sent to the browser.

export interface JiraMatchCandidate {
  key: string;
  url: string; // built server-side, since JIRA_BASE_URL is never sent to the browser
  summary: string;
  status: string;
  score: number; // 0..1, from similarity()
}

export interface FindJiraMatchResult {
  matches: JiraMatchCandidate[];
  error?: boolean; // true only when the Jira API call itself failed (auth/network) -- never throw
}

// Retry only on 429 (rate limited) or >=500 (transient server error) --
// a genuine 400 (bad JQL) or 401/403 (bad token/permissions) fails fast
// instead of burning retries on something that will never succeed.
// Reimplemented in TS here rather than importing scripts/jira-sync/lib/retry.mjs
// -- that's a separate plain Node ESM project not meant for cross-app imports.
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  {
    retries = 3,
    delayMs = 500,
    isRetryable = () => true,
  }: { retries?: number; delayMs?: number; isRetryable?: (err: unknown) => boolean } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const wait = delayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

interface JiraHttpError extends Error {
  status?: number;
}

interface JiraSearchIssue {
  key: string;
  fields: {
    summary: string;
    status?: { name?: string };
  };
}

interface JiraSearchResponse {
  issues: JiraSearchIssue[];
  nextPageToken?: string;
}

function authHeader(): string {
  const email = process.env["JIRA_EMAIL"];
  const token = process.env["JIRA_API_TOKEN"];
  if (!email || !token) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraSearch(jql: string): Promise<JiraSearchIssue[]> {
  const base = process.env["JIRA_BASE_URL"];
  if (!base) throw new Error("JIRA_BASE_URL not set");

  return withRetry(
    async () => {
      const res = await fetch(`${base}/rest/api/3/search/jql`, {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          fields: ["summary", "status"],
          maxResults: 10,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        const err: JiraHttpError = new Error(`Jira search failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      const body = (await res.json()) as JiraSearchResponse;
      return body.issues ?? [];
    },
    {
      isRetryable: (err) => isRetryableHttpStatus((err as JiraHttpError)?.status ?? 0),
    },
  );
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 200;
const cache = new Map<string, { at: number; result: FindJiraMatchResult }>();

function cacheGet(key: string): FindJiraMatchResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function cacheSet(key: string, result: FindJiraMatchResult): void {
  if (cache.size >= CACHE_MAX_SIZE && !cache.has(key)) {
    // No eviction policy beyond a basic size cap -- drop the oldest entry
    // (Map preserves insertion order, so the first key is the oldest).
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { at: Date.now(), result });
}

export const findJiraMatch = createServerFn({ method: "POST" })
  .validator((input: { summary: string }) => input)
  .handler(async ({ data }): Promise<FindJiraMatchResult> => {
    const { summary } = data;
    const normalizedSummary = normalize(summary);

    // Avoid noisy 1-2 word queries -- no API call.
    if (normalizedSummary.length < 6) {
      return { matches: [] };
    }

    const cacheKey = normalizedSummary;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
      // JQL, not SQL -- escaping quotes is for correctness (not breaking the
      // JQL string literal), not injection defense. Deliberately NOT scoped
      // to the item's own project's Jira key -- a ticket can legitimately
      // live on a different board than the stakeholder module it's tracked
      // under (e.g. a cross-team ticket, or one filed before the module's
      // board was settled), and restricting the search there just hides
      // real matches. This is a global summary search across all of Jira.
      const escaped = summary.replace(/"/g, '\\"');
      const jql = `summary ~ "${escaped}" ORDER BY updated DESC`;

      const issues = await jiraSearch(jql);

      const scored: JiraMatchCandidate[] = issues.map((issue) => ({
        key: issue.key,
        url: `${process.env["JIRA_BASE_URL"]}/browse/${issue.key}`,
        summary: issue.fields.summary,
        status: issue.fields.status?.name ?? "",
        score: similarity(normalizedSummary, normalize(issue.fields.summary)),
      }));

      const result: FindJiraMatchResult = {
        matches: scored
          .filter((m) => m.score > 0.55)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
      };

      cacheSet(cacheKey, result);
      return result;
    } catch {
      // Never throw out of the handler -- a failed Jira lookup (missing
      // env vars, network failure, exhausted retries) must never block the
      // calling UI from saving the form.
      return { matches: [], error: true };
    }
  });
