// Webhook signature verification, shared across sources -- GitHub and
// Jira Cloud both sign with the same wire format: a header whose value is
// "<method>=<hex digest>". Uses Web Crypto (crypto.subtle), available as
// a global in both the eventual Cloudflare Workers runtime and Node
// (stable since Node 19) -- deliberately not Node's `node:crypto`, which
// doesn't exist in Workers.
//
// Verified sources for the two header formats this supports:
// - GitHub: `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 over the raw
//   request body (docs/discovery.md §0.4, standard documented product
//   behavior).
// - Jira Cloud: `X-Hub-Signature: <method>=<hex>` (WebSub-style),
//   currently `sha256`, "Jira might start using another method for the
//   HMAC in the future" per Atlassian's own docs
//   (https://developer.atlassian.com/cloud/jira/platform/webhooks/,
//   fetched live 2026-09-22 -- available since Feb 2024, was previously
//   unconfirmed in this project).

const SUPPORTED_METHODS: Record<string, string> = { sha256: "SHA-256" };

function parseSignatureHeader(headerValue: string): { method: string; hex: string } | null {
  const match = /^([a-zA-Z0-9]+)=([0-9a-fA-F]+)$/.exec(headerValue);
  if (!match?.[1] || !match[2]) return null;
  return { method: match[1].toLowerCase(), hex: match[2].toLowerCase() };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

// Manual constant-time comparison: Web Crypto has no built-in timing-safe
// compare for arbitrary byte arrays (Node's crypto.timingSafeEqual isn't
// available in Workers). Always walks the full length of the longer
// array regardless of where a mismatch occurs.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Verifies a webhook body against a `<method>=<hex>`-formatted signature
 * header (GitHub's X-Hub-Signature-256, Jira's X-Hub-Signature). Returns
 * false for any malformed input rather than throwing -- an ingest Worker
 * should treat "can't verify" and "verification failed" identically:
 * reject with 401, do not touch the database (CLAUDE.md hard rule 3).
 */
export async function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  signatureHeaderValue: string | null,
): Promise<boolean> {
  if (!signatureHeaderValue) return false;

  const parsed = parseSignatureHeader(signatureHeaderValue);
  if (!parsed) return false;

  const algorithm = SUPPORTED_METHODS[parsed.method];
  if (!algorithm) return false;

  const expectedBytes = hexToBytes(parsed.hex);
  if (!expectedBytes) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));

  return timingSafeEqual(new Uint8Array(signature), expectedBytes);
}
