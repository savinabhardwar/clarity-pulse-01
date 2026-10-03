// Transport only. Database credentials and queries belong to Python.
export async function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  // Nitro supplies Cloudflare bindings here; Node development uses process.env.
  const bindings = (
    globalThis as typeof globalThis & {
      __env__?: Record<string, string>;
    }
  ).__env__;
  const base =
    bindings?.["CLARITY_BACKEND_URL"] ||
    process.env["CLARITY_BACKEND_URL"] ||
    "http://127.0.0.1:8001";
  const headers = new Headers(init.headers);
  const protection =
    bindings?.["BACKEND_PROTECTION_BYPASS"] || process.env["BACKEND_PROTECTION_BYPASS"];
  if (protection) headers.set("x-vercel-protection-bypass", protection);
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(25_000),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("The backend returned an unexpected redirect");
  }
  return response;
}
