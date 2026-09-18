// Summarizes a batch of completed Jira issues into feature-level release
// notes, modeled on the human-authored "QIP — Features till August 2026"
// catalog (Confluence page id 524091395) -- one bullet per actual feature
// ("**Feature Name** — capability description"), not one bullet per
// theme and not one line per ticket. That catalog page also establishes
// the convention this prompt reuses for partially-done work: "...is
// built and being finalized this sprint" rather than describing it as
// shipped. Uses Google Gemini since this runs headlessly in GitHub
// Actions (no Claude session/MCP access there).
//
// Completeness (pending subtasks / open "Blocks" dependencies) is
// computed deterministically in fetch-completed-issues.mjs, not left for
// the model to infer from a ticket summary -- see CLAUDE.md hard rule 5
// ("deterministic before intelligent"). This prompt only tells the model
// how to phrase what's already been determined; it never decides
// blocked/incomplete status itself.
import { withRetry, isRetryableHttpStatus } from "../jira-sync/lib/retry.mjs";

// Pin an exact model version and revisit periodically -- Google
// deprecates old Gemini model ids on a rolling basis.
const GEMINI_MODEL = "gemini-3.6-flash";
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
- Describe ONE FEATURE per bullet: "- **Feature Name** — one flowing sentence describing the capability." A feature is a user-visible capability, not a ticket -- several tickets (e.g. a design ticket, a frontend ticket, a backend/API ticket) often make up a single feature; collapse those into one bullet, don't write one bullet per ticket.
- Do not merge multiple distinct, unrelated features into one catch-all bullet just because they sit in the same area of the product.
- Only add a "## Feature Area" heading above a group of bullets when there are several distinct features that clearly belong together; a standalone feature needs no heading.
- Some tickets below are marked "[INCOMPLETE: ...]" -- meaning a subtask is still open, or the ticket is blocked by another issue that isn't done yet, even though Jira shows it as Done. Never describe that feature as shipped, delivered, completed, or resolved. Instead:
  (a) if the feature has no real user-visible progress yet, leave it out of these release notes entirely, or
  (b) if there is genuine working progress, describe what's done and end the bullet with a clause naming what's outstanding, in the exact voice of the reference example above: "...is built and being finalized this sprint." (adapt the trailing clause to name the actual open item if useful, e.g. "...and is pending its backend integration.")
- Do not invent details not implied by the ticket summaries.
- Output ONLY the bullet list (with any "## Feature Area" headings), nothing else -- no top-level title, no preamble.

Completed tickets:
${issueLines}`;
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
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
      return text;
    },
    { label: "Gemini summarize", isRetryable: (err) => isRetryableHttpStatus(err.status) },
  );
}

// Returns the raw "- **Feature Name** — sentence" markdown bullet list
// (with optional "## Feature Area" headings) as a string -- publish.mjs
// converts it to Confluence storage HTML.
export async function summarize({ product, issues }) {
  if (issues.length === 0) {
    return "* **No user-facing changes:** No tickets were completed in this period.";
  }
  const prompt = buildPrompt(product, issues);
  const text = await callGemini(prompt);
  return text.trim();
}
