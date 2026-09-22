import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProjectId } from "./project-resolution.ts";

function fakeFetch(response: { status: number; body: unknown }): typeof fetch {
  return (async (_url: string | URL) =>
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const config = { supabaseUrl: "https://example.supabase.co", serviceRoleKey: "test-key" };

test("resolves a Jira project key to an internal project id", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: [{ id: "proj-uuid-1" }] });
  const id = await resolveProjectId("jira", "LT", { ...config, fetchImpl });
  assert.equal(id, "proj-uuid-1");
});

test("returns null when no configured project matches (D24: record and drop, not an error)", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: [] });
  const id = await resolveProjectId("github", "some-org/unrelated-repo", { ...config, fetchImpl });
  assert.equal(id, null);
});

test("returns null for an unknown source rather than guessing a column", async () => {
  const fetchImpl = fakeFetch({ status: 200, body: [{ id: "should-not-be-reached" }] });
  const id = await resolveProjectId("carrier-pigeon", "whatever", { ...config, fetchImpl });
  assert.equal(id, null);
});

test("throws on a non-ok response rather than silently treating it as unresolved", async () => {
  const fetchImpl = fakeFetch({ status: 500, body: { message: "boom" } });
  await assert.rejects(() => resolveProjectId("jira", "LT", { ...config, fetchImpl }));
});

test("URL-encodes the hint (repo names contain a slash)", async () => {
  let capturedUrl = "";
  const fetchImpl = (async (url: string | URL) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify([{ id: "proj-uuid-2" }]), { status: 200 });
  }) as unknown as typeof fetch;
  await resolveProjectId("github", "alldayPA/line-tester", { ...config, fetchImpl });
  assert.match(capturedUrl, /git_repository=eq\.alldayPA%2Fline-tester/);
});
