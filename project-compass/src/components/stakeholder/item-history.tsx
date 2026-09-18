import { ArrowRight } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useItemHistory } from "@/data/queries";
import type { StakeholderItem } from "@/lib/stakeholder-types";

function fmt(at: string) {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

const EVENT_TITLE: Record<string, string> = {
  created: "Item Created",
};

function fieldTitle(fieldName: string | null) {
  if (!fieldName) return "Updated";
  const label = fieldName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Jira Url", "Jira Ticket Link")
    .replace("Will Be Done By", "Will Be Done By Date")
    .replace("Required By", "Required By Date")
    .replace("Deleted At", "Deletion");
  return fieldName === "comment"
    ? "Comment Updated"
    : fieldName === "attachments"
      ? "Attachments Updated"
      : `${label} Changed`;
}

export function ItemHistoryDrawer({
  item,
  onOpenChange,
}: {
  item: (Omit<StakeholderItem, "projectId"> & { projectId: string | null }) | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: entries, isLoading } = useItemHistory(item?.id);

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {item && (
          <>
            <SheetHeader className="border-b border-border px-6 py-4">
              <SheetTitle>Audit History</SheetTitle>
              <SheetDescription className="line-clamp-2">{item.summary}</SheetDescription>
            </SheetHeader>
            <div className="scroll-slim flex-1 overflow-y-auto px-6 py-6">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : !entries || entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet.</p>
              ) : (
                <ol className="relative space-y-6 border-l border-border pl-6">
                  {entries.map((h) => (
                    <li key={h.id} className="relative">
                      <span className="absolute top-1.5 -left-[27px] size-2.5 rounded-full border-2 border-card bg-brand" />
                      <p className="text-sm font-semibold text-foreground">
                        {h.eventType === "created"
                          ? EVENT_TITLE["created"]
                          : h.fieldName === "deleted_at" && h.newValue
                            ? "Item Deleted"
                            : fieldTitle(h.fieldName)}
                      </p>
                      {h.oldValue !== null && h.newValue !== null ? (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="rounded bg-surface-strong px-1.5 py-0.5 text-muted-foreground">
                            {h.oldValue || "—"}
                          </span>
                          <ArrowRight className="size-3.5 text-muted-foreground" />
                          <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">
                            {h.newValue || "—"}
                          </span>
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Changed by: {h.changedBy}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmt(h.changedAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
