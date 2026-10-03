// Transport only. Database credentials and queries belong to Python.
export function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env["CLARITY_BACKEND_URL"] || "http://127.0.0.1:8001";
  const headers = new Headers(init.headers);
  const protection = process.env["BACKEND_PROTECTION_BYPASS"];
  if (protection) headers.set("x-vercel-protection-bypass", protection);
  return fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
}
