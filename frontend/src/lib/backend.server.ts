// Transport only. Database credentials and queries belong to Python.
export function backendRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env["CLARITY_BACKEND_URL"] || "http://127.0.0.1:8001";
  return fetch(`${base.replace(/\/$/, "")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
}
