// Summarizes a batch of completed Jira issues into feature-level release
// notes, modeled on the human-authored "QIP — Features till August 2026"
// catalog (Confluence page id 524091395) -- one bullet per actual feature
// ("**Feature Name** — capability description"), not one bullet per
// theme and not one line per ticket. That catalog page also establishes
// the convention this prompt reuses for partially-done work: "...is
// built and being finalized this sprint" rather than describing it as
// shipped. Uses Google Gemini since this runs headlessly in GitHub
// Actions (no Claude session/MCP access there). Falls back to Cloudflare
// Workers AI (lib/workers-ai.mjs) only if every Gemini attempt fails --
// see callWithFallback below.
//
// Completeness (pending subtasks / open "Blocks" dependencies) is
// computed deterministically in fetch-completed-issues.mjs, not left for
// the model to infer from a ticket summary -- see CLAUDE.md hard rule 5
// ("deterministic before intelligent"). This prompt only tells the model
// how to phrase what's already been determined; it never decides
// blocked/incomplete status itself.
import { withRetry, isRetryableHttpStatus } from "../jira-sync/lib/retry.mjs";
import { summarizeWithWorkersAI, workersAiConfigured } from "./lib/workers-ai.mjs";

// Pin exact model versions and revisit periodically -- Google
// deprecates old Gemini model ids on a rolling basis.
//
// gemini-3.6-flash is primary: verified 2026-09-18 (docs/discovery.md
// §0.7) as the reliable one -- gemini-3.8-flash 503'd on 4/4 live
// attempts (both plain and structured requests) while 3.6-flash served
// normally. Do not swap the primary back to 3.8-flash on the strength of
// that history.
//
// gemini-3.8-flash is kept ONLY as a same-provider fallback for 429
// (rate-limited) specifically -- not for 503/other failures, where 3.8
// has already shown itself to be the less reliable model. The two model
// ids plausibly draw from separate free-tier quota buckets, so a 429 on
// 3.6-flash is worth one attempt against 3.8-flash before giving up.
// This is not the second-provider fallback CLAUDE.md §2 rules out ("If
// Gemini is down, queue and wait. Do not add a second provider") --
// it's the same provider, same account, a different model id.
const GEMINI_MODEL_PRIMARY = "gemini-3.6-flash";
const GEMINI_MODEL_FALLBACK = "gemini-3.8-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function buildPrompt(product, issues) {
  const issueLines = issues
    .map((i) => {
      const flag = i.completenessNote ? ` [INCOMPLETE: ${i.completenessNote}]` : "";
      return `- [${i.issuetype}] ${i.key}: ${i.summary}${flag}`;
    })
    .join("\n");
  return `You are writing release notes for the "${product}" product, in the exact style below (this is a real excerpt from "QIP — Features till August 2026", the reference feature catalog for this document set -- do not deviate from this structure):

- **Standalone coaching sessions** — Schedule coaching without requiring an evaluation or dispute, for both agents and QA.
- **Action plan tracking** — Assign individual due dates and track completion for each coaching action.
- **AI Coaching Practice Calls** — The full practice-call experience — talk to an AI customer, see live call activity, review the transcript — is built and being finalized this sprint.

Rules:
- Describe ONE FEATURE per bullet: "- **<a specific feature name you write, e.g. "Standalone Coaching Sessions">** — one flowing sentence describing the capability." <Feature Name> is a placeholder for a real, specific name you invent from the tickets -- never output the literal words "Feature Name". A feature is a user-visible capability, not a ticket -- several tickets (e.g. a design ticket, a frontend ticket, a backend/API ticket) often make up a single feature; collapse those into one bullet, don't write one bullet per ticket.
- Do not merge multiple distinct, unrelated features into one catch-all bullet just because they sit in the same area of the product.
- Leave out internal QA/test-automation work and infrastructure/ops/tooling work entirely -- these are not user-visible capabilities, no matter how much effort they took. Examples of tickets to EXCLUDE: "Gamification Automation Testing", "CX Pass Integration Testing", "Migrate to SQLAlchemy", "Kubernetes deployment migration", "API versioning infrastructure", "Debug high chatbot latency" (an internal investigation, not a shipped change), "Remove unnecessary fields" (internal cleanup). Do NOT over-apply this: a ticket is only excluded if the WORK ITSELF is testing or infrastructure -- a ticket about a genuine user-facing capability that happens to have "test" in its name stays in, e.g. "AI Simulation Test Workflow" (a feature letting admins simulate a chat conversation before publishing it) is a real product feature, not QA work, and belongs in the release notes like any other feature.
- Only add a heading, formatted "## <a specific area name you write, e.g. "Platform Infrastructure & Integrations">", above a group of bullets when there are several distinct features that clearly belong together; a standalone feature needs no heading. <area name> is a placeholder for a real, specific name you invent -- never output the literal words "Feature Area". The same "don't merge unrelated things" rule applies to headings, not just bullets: e.g. "Knowledge Hub" (content ingestion -- web scraping, video processing, integrations) and "AI Self-Learning" (post-call analysis generating prompt recommendations) are different capabilities that happen to sit near each other in the product -- give them separate headings, don't combine into "Knowledge Hub & AI Self-Learning" or any other joined name. If you're naming a heading with "&" or "and" joining two nouns, stop and check whether that's actually one capability or two being forced together.
- Some tickets below are marked "[INCOMPLETE: ...]" -- meaning a subtask is still open, or another linked ticket (e.g. a separate frontend/backend/design half of the same feature) isn't done yet, even though this ticket itself shows as Done in Jira. Never describe that feature as shipped, delivered, completed, or resolved. Instead:
  (a) if the feature has no real user-visible progress yet, leave it out of these release notes entirely, or
  (b) if there is genuine working progress, describe what's done and end the bullet with a clause naming what's outstanding, in the exact voice of the reference example above: "...is built and being finalized this sprint." (adapt the trailing clause to name the actual open item if useful, e.g. "...and is pending its backend integration.")
- Do not invent details not implied by the ticket summaries.
- Output ONLY the bullet list (with any "## <area name>" headings), nothing else -- no top-level title, no preamble.

Completed tickets:
${issueLines}`;
}

async function requestModel(model, prompt, { retries } = {}) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  return withRetry(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Gemini request failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      const body = await res.json();
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      if (!text.trim()) throw new Error("Gemini returned an empty response");
      console.log(
        `[release-notes] ${model} served the summary (reported version: ${body.modelVersion ?? "unknown"})`,
      );
      return text;
    },
    {
      label: `Gemini summarize (${model})`,
      retries,
      isRetryable: (err) => isRetryableHttpStatus(err.status),
    },
  );
}

async function callGemini(prompt) {
  try {
    return await requestModel(GEMINI_MODEL_PRIMARY, prompt);
  } catch (err) {
    if (err.status !== 429) throw err;
    console.warn(
      `[release-notes] ${GEMINI_MODEL_PRIMARY} exhausted retries on 429 -- trying ${GEMINI_MODEL_FALLBACK} once`,
    );
    return requestModel(GEMINI_MODEL_FALLBACK, prompt, { retries: 1 });
  }
}

// Last resort: both Gemini models (429 path included) have failed --
// try Cloudflare Workers AI before giving up entirely, so one bad Gemini
// day doesn't block a whole release notes cycle. This is intentionally
// AFTER Gemini's own retry/fallback logic above, not a parallel race --
// Gemini's output is better tuned for this prompt, so it's tried
// exhaustively first. If Workers AI isn't configured (no Cloudflare
// creds), the original Gemini error is what surfaces, unchanged.
async function callWithFallback(prompt) {
  try {
    return await callGemini(prompt);
  } catch (geminiErr) {
    if (!workersAiConfigured()) throw geminiErr;
    console.warn(
      `[release-notes] Gemini failed (${geminiErr.message}) -- falling back to Workers AI`,
    );
    try {
      return await summarizeWithWorkersAI(prompt);
    } catch (workersErr) {
      console.error(`[release-notes] Workers AI fallback also failed: ${workersErr.message}`);
      throw geminiErr; // surface the primary provider's error, not the fallback's
    }
  }
}

// Returns the raw "- **Feature Name** — sentence" markdown bullet list
// (with optional "## Feature Area" headings) as a string -- publish.mjs
// converts it to Confluence storage HTML.
export async function summarize({ product, issues }) {
  if (issues.length === 0) {
    return "* **No user-facing changes:** No tickets were completed in this period.";
  }
  const prompt = buildPrompt(product, issues);
  const text = await callWithFallback(prompt);
  return text.trim();
}
