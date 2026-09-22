import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSignature } from "./hmac.ts";

// Atlassian's own published test vector
// (https://developer.atlassian.com/cloud/jira/platform/webhooks/,
// fetched live 2026-09-22), independently recomputed with node:crypto
// before trusting it (a4771c...63c9, 64 hex chars, matches exactly) --
// proves the implementation is actually correct, not just internally
// self-consistent with itself.
const ATLASSIAN_SECRET = "It's a Secret to Everybody";
const ATLASSIAN_PAYLOAD = "Hello World!";
const ATLASSIAN_SIGNATURE =
  "sha256=a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9";

test("verifies against Atlassian's own published test vector", async () => {
  const ok = await verifyWebhookSignature(ATLASSIAN_PAYLOAD, ATLASSIAN_SECRET, ATLASSIAN_SIGNATURE);
  assert.equal(ok, true);
});

test("rejects a tampered body against a valid-looking header", async () => {
  const ok = await verifyWebhookSignature(
    "Hello World?", // one character different
    ATLASSIAN_SECRET,
    ATLASSIAN_SIGNATURE,
  );
  assert.equal(ok, false);
});

test("rejects the right body with the wrong secret", async () => {
  const ok = await verifyWebhookSignature(ATLASSIAN_PAYLOAD, "wrong secret", ATLASSIAN_SIGNATURE);
  assert.equal(ok, false);
});

test("rejects a missing signature header", async () => {
  const ok = await verifyWebhookSignature(ATLASSIAN_PAYLOAD, ATLASSIAN_SECRET, null);
  assert.equal(ok, false);
});

test("rejects a malformed header (no method= prefix)", async () => {
  const ok = await verifyWebhookSignature(
    ATLASSIAN_PAYLOAD,
    ATLASSIAN_SECRET,
    "a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9",
  );
  assert.equal(ok, false);
});

test("rejects an unsupported hash method", async () => {
  const ok = await verifyWebhookSignature(ATLASSIAN_PAYLOAD, ATLASSIAN_SECRET, "md5=deadbeef");
  assert.equal(ok, false);
});

test("rejects non-hex signature content", async () => {
  const ok = await verifyWebhookSignature(
    ATLASSIAN_PAYLOAD,
    ATLASSIAN_SECRET,
    "sha256=not-hex-at-all!!",
  );
  assert.equal(ok, false);
});

test("GitHub-style header (X-Hub-Signature-256 value) works with the same function", async () => {
  // GitHub uses the identical "sha256=<hex>" wire format -- one function
  // for both sources, just a different header NAME at the Worker layer
  // (task 3.3), not a different verification algorithm.
  const secret = "github-webhook-secret";
  const body = JSON.stringify({ action: "opened" });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const hex = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ok = await verifyWebhookSignature(body, secret, `sha256=${hex}`);
  assert.equal(ok, true);
});
