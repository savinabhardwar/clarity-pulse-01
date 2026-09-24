import { ArrowUp, Minus, ArrowDown, GitBranch } from "lucide-react";

import type { Priority, StatusKind } from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

const statusTone: Record<string, string> = {
  "To Do": "bg-surface-strong text-muted-foreground border-border",
  "In Progress": "bg-brand-soft text-brand border-brand/25",
  "In Review": "bg-jira-soft text-jira border-jira/25",
  Done: "bg-stake-soft text-stake border-stake/25",
  "Waiting for Spec": "bg-mid-soft text-mid border-mid/25",
  "Waiting for confirmation": "bg-mid-soft text-mid border-mid/25",
  "Clarification Needed": "bg-high-soft text-high border-high/25",
  Deprioritised: "bg-surface-strong text-muted-foreground border-border",
  "Reviewing Requirements": "bg-low-soft text-low border-low/25",
};

export function StatusBadge({ status, kind }: { status: string; kind: StatusKind }) {
  const resolved = kind;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          statusTone[status] ?? "bg-surface-strong text-muted-foreground border-border",
        )}
      >
        {status}
      </span>
      <span
        title={resolved === "jira" ? "Jira status" : "Stakeholder status"}
        className={cn(
          "rounded px-1 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase",
          resolved === "jira" ? "bg-jira-soft text-jira" : "bg-stake-soft text-stake",
        )}
      >
        {resolved === "jira" ? "Jira" : "Stkh"}
      </span>
    </span>
  );
}

// A client request created with 2+ candidate projects, awaiting someone to
// pick its one destination project (see stakeholder_items_assign_project).
export function DecisionBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-mid/25 bg-mid-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-mid">
      <GitBranch className="size-3" />
      Decision needed
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const map = {
    High: { cls: "bg-high-soft text-high border-high/25", Icon: ArrowUp },
    Medium: { cls: "bg-mid-soft text-mid border-mid/25", Icon: Minus },
    Low: { cls: "bg-low-soft text-low border-low/25", Icon: ArrowDown },
  } as const;
  const { cls, Icon } = map[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="size-3" />
      {priority}
    </span>
  );
}
