import { markJiraDone } from "@/actions/mark-jira-done";

export type PushDoneResult = { ok: true; keys: string[] } | { ok: false; message: string };

// Moves every Jira ticket linked to a Compass item to Done (server-side, see
// actions/mark-jira-done.ts). Resolves with a result instead of throwing so
// each caller can show the message and decide whether to still write Done to
// Compass: it must not if any ticket is still open in Jira.
export async function pushDoneToJira(itemId: string): Promise<PushDoneResult> {
  try {
    const result = await markJiraDone({ data: { itemId } });
    if (result.error) return { ok: false, message: `Not marked Done: ${result.error}` };
    if (result.failed.length > 0) {
      return {
        ok: false,
        message: `Could not mark Done in Jira: ${result.failed
          .map((f) => `${f.key} (${f.reason})`)
          .join("; ")}`,
      };
    }
    return { ok: true, keys: result.done };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not reach Jira" };
  }
}
