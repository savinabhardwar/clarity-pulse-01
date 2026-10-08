import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { canMarkDoneInJira } from "@/lib/stakeholder-types";

// Server-only: pushes "Done" from Project Compass to Jira. Called when someone
// moves a Jira-linked item from Review/Testing to Done in the UI; every Jira
// ticket linked to the item is transitioned to Done. The caller then writes
// Done on the Compass item itself (useUpdateItem), so history records the real
// actor; if that second step is lost, the Jira webhook writes the same status
// back anyway.

export interface MarkJiraDoneResult {
  // Tickets now in Done (just transitioned, or already there).
  done: string[];
  // Tickets that could not be moved, with the reason. Never throws.
  failed: { key: string; reason: string }[];
  // Set instead of the above when nothing was attempted (not eligible, no links...).
  error?: string;
}

export const markJiraDone = createServerFn({ method: "POST" })
  .validator((input: { itemId: string }) => input)
  .handler(async ({ data }): Promise<MarkJiraDoneResult> => {
    const empty = { done: [], failed: [] };
    try {
      // Imported lazily so the Jira helpers (node Buffer, process.env) stay
      // out of the client bundle.
      const { cleanJiraKey, transitionIssueToDone } = await import("@/lib/jira.server");

      // Re-check on the server rather than trusting the browser: this endpoint
      // moves real Jira tickets, so only act on an item that is genuinely in an
      // eligible status and genuinely linked to those tickets.
      const { data: item, error: itemError } = await supabase
        .from("stakeholder_items")
        .select("id,status,deleted_at")
        .eq("id", data.itemId)
        .maybeSingle();
      if (itemError) return { ...empty, error: `Could not load the item: ${itemError.message}` };
      if (!item || item.deleted_at) return { ...empty, error: "Item not found" };
      if (!canMarkDoneInJira(item.status)) {
        return { ...empty, error: `Status "${item.status}" is not Review or Testing` };
      }

      const { data: links, error: linksError } = await supabase
        .from("stakeholder_item_jira_links")
        .select("jira_key")
        .eq("item_id", data.itemId);
      if (linksError)
        return { ...empty, error: `Could not load Jira links: ${linksError.message}` };

      const keys = [
        ...new Set((links ?? []).map((l) => cleanJiraKey(l.jira_key)).filter((k) => k !== null)),
      ];
      if (keys.length === 0) return { ...empty, error: "No Jira ticket is linked to this item" };

      const result: MarkJiraDoneResult = { done: [], failed: [] };
      for (const key of keys) {
        try {
          await transitionIssueToDone(key);
          result.done.push(key);
        } catch (err) {
          result.failed.push({ key, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return result;
    } catch (err) {
      return { ...empty, error: err instanceof Error ? err.message : String(err) };
    }
  });
