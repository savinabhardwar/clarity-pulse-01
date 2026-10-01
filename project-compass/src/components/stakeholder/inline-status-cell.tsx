import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/stakeholder/badges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useItemJiraLinks, useUpdateItem } from "@/data/queries";
import {
  JIRA_STATUSES,
  STAKEHOLDER_STATUSES,
  type ItemDraft,
  type StakeholderItem,
} from "@/lib/stakeholder-types";

type StatusCellItem = Pick<
  StakeholderItem,
  | "id"
  | "requestType"
  | "summary"
  | "description"
  | "status"
  | "statusKind"
  | "priority"
  | "createdBy"
  | "requiredBy"
  | "willBeDoneBy"
>;

// Status cell that can be changed straight from the table, without opening
// the Edit form. Offers the same option lists item-form.tsx does (the
// stakeholder list for a stakeholder-kind status, Jira's for a jira-kind one)
// and commits through the same stakeholder_items_update RPC as the other
// inline cells, leaving every other field on the draft untouched.
//
// An item linked to a Jira ticket is read-only here: its status is rewritten
// from Jira by the webhook (api.jira-webhook.ts) and the daily
// sync-stakeholder-jira-status job, so a manual change would silently revert
// the next time the ticket moves. Change it in Jira instead.
export function InlineStatusCell({ item }: { item: StatusCellItem }) {
  const updateItem = useUpdateItem();
  const links = useItemJiraLinks(item.id);
  const [editing, setEditing] = useState(false);

  const badge = <StatusBadge status={item.status} kind={item.statusKind} />;

  // Treat "still loading the links" like linked: better a momentarily
  // read-only badge than offering a change that is about to be overwritten.
  if (links.isLoading || (links.data?.length ?? 0) > 0) {
    return (
      <span
        title={
          links.isLoading
            ? undefined
            : "Linked to a Jira ticket — status is synced from Jira, so change it there"
        }
      >
        {badge}
      </span>
    );
  }

  function commit(next: string) {
    setEditing(false);
    if (next === item.status) return;

    const draft: ItemDraft = {
      requestType: item.requestType,
      summary: item.summary,
      description: item.description,
      status: next,
      statusKind: item.statusKind,
      priority: item.priority,
      createdBy: item.createdBy,
      requiredBy: item.requiredBy,
      willBeDoneBy: item.willBeDoneBy,
    };

    updateItem.mutate(
      { id: item.id, draft },
      {
        onSuccess: () => toast.success(`Status changed to ${next}`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (editing) {
    const base: string[] = [
      ...(item.statusKind === "stakeholder" ? STAKEHOLDER_STATUSES : JIRA_STATUSES),
    ];
    // A stored status that's in neither list (it can only have come from
    // Jira) must still be selectable-as-current, or the Select renders blank.
    const options = base.includes(item.status) ? base : [item.status, ...base];

    return (
      <Select
        open
        value={item.status}
        onValueChange={commit}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      >
        <SelectTrigger className="h-8 w-auto min-w-[170px]" autoFocus aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={updateItem.isPending}
      title="Click to change status"
      className="group inline-flex items-center gap-1 rounded hover:opacity-80 disabled:opacity-60"
    >
      {badge}
      <ChevronDown className="size-3 text-[#667085] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
