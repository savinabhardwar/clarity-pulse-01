// Cross-account fallback for summarize.mjs when Gemini's free tier is
// unavailable (503, or exhausted retries) -- Cloudflare Workers AI, not a
// second LLM vendor account: this repo already holds Cloudflare
// credentials (ai-pm-platform/.dev.vars, same account used for Workers/
// Pages/Queues/KV elsewhere in this codebase), so this adds no new
// vendor relationship, just a different model on infrastructure already
// in use. Callable over plain REST from anywhere (GitHub Actions
// included), not only from inside a Worker.
//
// This is deliberately a LAST-RESORT fallback, not a load-balanced
// alternative -- Gemini's output quality (feature-level grouping,
// phrasing nuance for incomplete work) is better tuned for this prompt.
// Workers AI only serves a request when every Gemini attempt in
// summarize.mjs has already failed.
import { withRetry, isRetryableHttpStatus } from "../../jira-sync/lib/retry.mjs";

// Pin an exact model id and revisit periodically, same discipline as the
// Gemini ids in summarize.mjs -- Workers AI model availability changes.
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export function workersAiConfigured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

export async function summarizeWithWorkersAI(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set -- Workers AI fallback unavailable");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${WORKERS_AI_MODEL}`;

  return withRetry(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        // Default max_tokens on this endpoint is low enough to silently
        // truncate a real release-notes batch mid-bullet (confirmed live
        // 2026-09-22 against a 68-issue CX Omni batch -- the response cut
        // off mid-word with no error, and got published truncated before
        // this fix). 4096 comfortably covers the largest batch seen so
        // far (CX Pass, 153 issues); revisit if a bigger batch shows up.
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Workers AI request failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      const body = await res.json();
      if (!body.success) {
        throw new Error(`Workers AI returned an error: ${JSON.stringify(body.errors)}`);
      }
      // finish_reason "length" means the model hit max_tokens and was cut
      // off mid-output -- this must fail loudly, not publish a truncated
      // page (exactly what happened before this check existed).
      const finishReason = body.result?.choices?.[0]?.finish_reason;
      if (finishReason && finishReason !== "stop") {
        throw new Error(`Workers AI response was truncated (finish_reason: ${finishReason})`);
      }
      const text = body.result?.response ?? "";
      if (!text.trim()) throw new Error("Workers AI returned an empty response");
      console.log(`[release-notes] ${WORKERS_AI_MODEL} (Workers AI fallback) served the summary`);
      return text.trim();
    },
    { label: `Workers AI summarize (${WORKERS_AI_MODEL})`, isRetryable: (err) => isRetryableHttpStatus(err.status) },
  );
}
