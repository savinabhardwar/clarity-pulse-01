import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { backendRequest } from "../../../frontend/src/lib/backend.server.ts";

const settings = JSON.parse(await readFile(new URL("./service.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
const originalBase = process.env[settings.backendVariable];
const originalProtection = process.env.BACKEND_PROTECTION_BYPASS;
const originalBindings = globalThis.__env__;
let request;
try {
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  };
  process.env[settings.backendVariable] = "https://api.example.com/";
  process.env.BACKEND_PROTECTION_BYPASS = "isolated-fixture-bypass";
  await backendRequest("/api/projects", { method: "GET", headers: { Authorization: "Bearer fixture-user" } });
  assert.equal(request.url, "https://api.example.com/api/projects");
  assert.equal(request.init.headers.get("x-vercel-protection-bypass"), "isolated-fixture-bypass");
  assert.equal(request.init.headers.get("Authorization"), "Bearer fixture-user");
  assert.equal(request.init.redirect, "manual");
  delete process.env.BACKEND_PROTECTION_BYPASS;
  await backendRequest("/api/projects", { method: "GET" });
  assert.equal(request.init.headers.has("x-vercel-protection-bypass"), false);
  globalThis.__env__ = {
    [settings.backendVariable]: "https://worker-api.example.com",
    BACKEND_PROTECTION_BYPASS: "worker-fixture-bypass",
  };
  await backendRequest("/api/projects", { method: "GET" });
  assert.equal(request.url, "https://worker-api.example.com/api/projects");
  assert.equal(request.init.headers.get("x-vercel-protection-bypass"), "worker-fixture-bypass");
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://other.example.com" } });
  await assert.rejects(backendRequest("/api/projects", { method: "GET" }), /unexpected redirect/);
  console.log("PASS protected/unprotected server proxy headers and user authorization");
} finally {
  globalThis.fetch = originalFetch;
  if (originalBindings === undefined) delete globalThis.__env__;
  else globalThis.__env__ = originalBindings;
  if (originalBase === undefined) delete process.env[settings.backendVariable];
  else process.env[settings.backendVariable] = originalBase;
  if (originalProtection === undefined) delete process.env.BACKEND_PROTECTION_BYPASS;
  else process.env.BACKEND_PROTECTION_BYPASS = originalProtection;
}
