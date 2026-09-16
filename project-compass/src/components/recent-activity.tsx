import { ArrowRight, Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentActivity } from "@/data/queries";
import type { RecentActivityEntry } from "@/lib/stakeholder-types";

function fmt(at: string) {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(
    "en-US",
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

// Same "TitleCase field name" mapping convention as item-history.tsx, plus
// the couple of synthetic field_name values the RPCs write directly
// (jira_links, attachments -- see 0002_stakeholder_rls_and_functions.sql and
// 0008_multiple_jira_links.sql) rather than the audit trigger's column list.
const FIELD_LABELS: Record<string, string> = {
  summary: "Summary",
  description: "Description",
  status: "Status",
  status_kind: "Status Kind",
  priority: "Priority",
  created_by: "Created By",
  required_by: "Required By Date",
  will_be_done_by: "Will Be Done By Date",
  jira_links: "Jira links",
  attachments: "Attachments",
};

function fieldLabel(field: string | null): string {
  if (!field) return "something";
  return (
    FIELD_LABELS[field] ??
    field
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Short/meaningful values worth showing inline as an old -> new chip pair.
const SHOW_VALUE_FIELDS = new Set(["status", "priority", "status_kind", "required_by", "will_be_done_by"]);

function describe(entry: RecentActivityEntry): { text: string; showValues: boolean } {
  const who = entry.changedBy;
  const what = entry.itemSummary ? `"${entry.itemSummary}"` : "an item";

  if (entry.eventType === "created") {
    return { text: `${who} created ${what}`, showValues: false };
  }
  if (entry.eventType === "deleted") {
    return { text: `${who} deleted ${what}`, showValues: false };
  }
  // event_type === "updated"
  if (entry.fieldName === "deleted_at") {
    return entry.newValue
      ? { text: `${who} deleted ${what}`, showValues: false }
      : { text: `${who} restored ${what}`, showValues: false };
  }
  const label = fieldLabel(entry.fieldName);
  return {
    text: `${who} changed ${label} on ${what}`,
    showValues: !!entry.fieldName && SHOW_VALUE_FIELDS.has(entry.fieldName),
  };
}

function ActivityRow({ entry }: { entry: RecentActivityEntry }) {
  const { text, showValues } = describe(entry);
  const kindLabel =
    entry.kind === "feature"
      ? "Feature"
      : entry.kind === "implementation"
        ? "Client Request"
        : null;

  return (
    <li className="border-b border-border px-4 py-3 last:border-b-0">
      <p className="text-sm text-foreground">{text}</p>
      {showValues && entry.oldValue !== null && entry.newValue !== null ? (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-surface-strong px-1.5 py-0.5 text-muted-foreground">
            {entry.oldValue || "—"}
          </span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">{entry.newValue || "—"}</span>
        </p>
      ) : null}
      {entry.projectName ? (
        <p className="mt-1 text-xs text-muted-foreground">
          in {entry.projectName}
          {entry.projectCode ? ` (${entry.projectCode})` : ""}
          {kindLabel ? ` · ${kindLabel}` : ""}
        </p>
      ) : null}
      <p className="mt-0.5 text-[11px] text-muted-foreground/80">{fmt(entry.changedAt)}</p>
    </li>
  );
}

export function RecentActivity() {
  const { data: entries, isLoading } = useRecentActivity(50);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Recent activity">
          <Bell className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Recent activity</p>
        </div>
        <div className="scroll-slim max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No recent activity yet.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
