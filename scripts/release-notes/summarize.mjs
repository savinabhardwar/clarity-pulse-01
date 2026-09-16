// Summarizes a batch of completed Jira issues into the exact bullet
// format used by the manually-authored QIP example (Confluence page id
// 528908289): one bold-themed bullet per topic, consolidating every
// ticket under that theme into a single prose sentence -- not a raw
// per-ticket list. Uses Google Gemini since this runs headlessly in
// GitHub Actions (no Claude session/MCP access there).
import { withRetry, isRetryableHttpStatus } from "../jira-sync/lib/retry.mjs";

// Pin an exact model version and revisit periodically -- Google
// deprecates old Gemini model ids on a rolling basis.
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function buildPrompt(product, issues) {
  const issueLines = issues
    .map((i) => `- [${i.issuetype}] ${i.key}: ${i.summary}`)
    .join("\n");
  return `You are writing release notes for the "${product}" product, in the exact style below (this is a real example from the same document set, do not deviate from this structure):

* **CX Pass Integration:** Integrated QIP with CX Pass, including SSO login, company and user synchronization, CX Pass ID support, role validation, CX Omni Chats transcript integration, username support in extensions, and Call Care company setup.
* **CX Pass Bug Fixes:** Resolved issues related to agent visibility, evaluation creation, team and extension display, role synchronization, resync actions, and automated evaluation creation.

Rules:
- Group the tickets below into a small number of sensible themes (by feature area, or "Bug Fixes" / "Testing & Release Readiness" for maintenance work).
- Output ONE bullet per theme, each starting with "* **Theme Name:**" followed by a SINGLE flowing sentence that weaves together everything shipped under that theme. Do not list ticket keys or write one sentence per ticket.
- Do not invent details not implied by the ticket summaries.
- Output ONLY the bullet list, nothing else (no heading, no preamble).

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

// Returns the raw "* **Theme:** sentence" markdown bullet list as a
// string -- publish.mjs converts it to Confluence storage HTML.
export async function summarize({ product, issues }) {
  if (issues.length === 0) {
    return "* **No user-facing changes:** No tickets were completed in this period.";
  }
  const prompt = buildPrompt(product, issues);
  const text = await callGemini(prompt);
  return text.trim();
}
