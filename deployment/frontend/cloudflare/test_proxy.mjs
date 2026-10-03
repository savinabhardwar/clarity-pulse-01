import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { backendRequest } from "../../../frontend/src/lib/backend.server.ts";

const settings = JSON.parse(await readFile(new URL("./service.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
const originalBase = process.env[settings.backendVariable];
const originalProtection = process.env.BACKEND_PROTECTION_BYPASS;
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
  assert.equal(request.init.redirect, "error");
  delete process.env.BACKEND_PROTECTION_BYPASS;
  await backendRequest("/api/projects", { method: "GET" });
  assert.equal(request.init.headers.has("x-vercel-protection-bypass"), false);
  console.log("PASS protected/unprotected server proxy headers and user authorization");
} finally {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env[settings.backendVariable];
  else process.env[settings.backendVariable] = originalBase;
  if (originalProtection === undefined) delete process.env.BACKEND_PROTECTION_BYPASS;
  else process.env.BACKEND_PROTECTION_BYPASS = originalProtection;
}
