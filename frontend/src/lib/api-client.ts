export async function apiRequest<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/clarity${path}`);
  } catch {
    throw new Error("The ClarityPulse backend is unavailable");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string" ? error.detail : "The request could not be completed",
    );
  }
  return response.json();
}
