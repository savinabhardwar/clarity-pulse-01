// Generic retry-with-backoff for transient failures -- the exact class
// of problem that has actually hit this pipeline in production: a
// momentary Postgres auth/connection blip (confirmed 2026-08-05: a
// scheduled run failed with "password authentication failed for user
// postgres", then a manual rerun minutes later succeeded with the SAME
// secret -- a transient pooler hiccup, not a genuinely wrong
// credential), and Jira API rate limiting / transient 5xx responses.
// Without this, either kind of blip fails the entire daily sync and
// waits for a human to notice and manually rerun it.
export async function withRetry(fn, { retries = 3, delayMs = 2000, label = "operation", isRetryable = () => true } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const wait = delayMs * 2 ** (attempt - 1);
      console.warn(`[retry] ${label} failed (attempt ${attempt}/${retries}): ${err.message} -- retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Postgres auth/connection errors that are plausibly transient (a
// momentary pooler hiccup) rather than a genuinely wrong credential --
// 28P01 (password auth failed) is included deliberately: it's exactly
// what the 2026-08-05 incident threw, and it self-resolved on a bare
// retry with the same secret, so treating it as retryable-once is a
// reasonable default. If it's a REAL stale/rotated secret, all retries
// will exhaust and the run still fails (and files an issue) same as before.
export function isRetryablePgError(err) {
  const retryableCodes = new Set([
    "28P01", // password authentication failed
    "57P03", // cannot connect now (server starting up)
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
  ]);
  return retryableCodes.has(err.code) || /connection|timeout/i.test(err.message ?? "");
}

// Jira REST errors worth retrying: rate limiting and transient server
// errors. A genuine 401/403 (bad token/permissions) or 400 (bad JQL)
// should fail immediately, not burn retries on something that will
// never succeed.
export function isRetryableHttpStatus(status) {
  return status === 429 || status >= 500;
}
