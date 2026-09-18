// Thin Confluence REST v2 client for the GitHub Actions runner (no MCP
// access there -- MCP tools only exist inside interactive Claude
// sessions). Same Atlassian Cloud site as Jira, same Basic-auth
// credential (email + API token) -- see scripts/jira-sync/fetch-jira-rest.mjs.
import { withRetry, isRetryableHttpStatus } from "../../jira-sync/lib/retry.mjs";

const JIRA_BASE = process.env.JIRA_BASE_URL; // e.g. https://alldaypa.atlassian.net
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const WIKI_BASE = () => `${JIRA_BASE}/wiki/api/v2`;

function authHeader() {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error("JIRA_EMAIL / JIRA_API_TOKEN not set");
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

async function request(path, { method = "GET", body, label } = {}) {
  return withRetry(
    async () => {
      const res = await fetch(`${WIKI_BASE()}${path}`, {
        method,
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Confluence ${method} ${path} failed: ${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    },
    {
      label: label ?? `Confluence ${method} ${path}`,
      isRetryable: (err) => isRetryableHttpStatus(err.status),
    },
  );
}

export async function getPage(pageId, { bodyFormat = "storage" } = {}) {
  return request(`/pages/${pageId}?body-format=${bodyFormat}`);
}

// Only returns metadata (id, title, parentId) -- no body. Used to find
// the newest existing "{Product} Release Notes: ..." child page and to
// check for an exact-title duplicate before publishing.
export async function getPageChildren(pageId) {
  const results = [];
  let cursor;
  do {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const body = await request(`/pages/${pageId}/children${qs}`);
    results.push(...body.results);
    cursor = body._links?.next
      ? new URL(body._links.next, WIKI_BASE()).searchParams.get("cursor")
      : null;
  } while (cursor);
  return results;
}

export async function createPage({ spaceId, parentId, title, bodyHtml, status = "current" }) {
  return request("/pages", {
    method: "POST",
    label: `Confluence createPage(${title})`,
    body: {
      spaceId,
      parentId,
      title,
      status,
      body: { representation: "storage", value: bodyHtml },
    },
  });
}

export async function updatePage(pageId, { title, bodyHtml, version, status = "current" }) {
  return request(`/pages/${pageId}`, {
    method: "PUT",
    label: `Confluence updatePage(${pageId})`,
    body: {
      id: pageId,
      status,
      title,
      body: { representation: "storage", value: bodyHtml },
      version: { number: version, message: "release-notes automation" },
    },
  });
}
