import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Eye,
  FlaskConical,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { Priority, RequestType, StatusKind } from "@/lib/stakeholder-types";
import { requestTypeLabel } from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

// Status pill colors, per docs/"Project Compass UI refinement" §4 (Status
// badges). The spec only names 7 statuses; the rest of this org's real
// status set (see JIRA_STATUSES/STAKEHOLDER_STATUSES) is mapped onto the
// nearest spec tone so every status still renders, not just the 7 shown in
// the reference screenshot. "On Hold" never appears in real data (grepped
// clean) but is aliased to "Testing" per the spec's explicit instruction.
const STATUS_ALIAS: Record<string, string> = {
  "On Hold": "Testing",
};

const statusTone: Record<string, { cls: string; Icon: LucideIcon }> = {
  "To Do": { cls: "bg-[#F2F4F7] text-[#475467]", Icon: Clock },
  Idea: { cls: "bg-[#F2F4F7] text-[#475467]", Icon: Clock },
  Deprioritised: { cls: "bg-[#F2F4F7] text-[#475467]", Icon: Clock },
  "In Progress": { cls: "bg-[#EAF4FF] text-[#075A8C]", Icon: RefreshCw },
  Testing: { cls: "bg-[#EAF4FF] text-[#175CD3]", Icon: FlaskConical },
  "Code Review": { cls: "bg-[#F2ECFF] text-[#6941C6]", Icon: Eye },
  "In Review": { cls: "bg-[#F2ECFF] text-[#6941C6]", Icon: Eye },
  Review: { cls: "bg-[#F2ECFF] text-[#6941C6]", Icon: Eye },
  "Reviewing Requirements": { cls: "bg-[#F2ECFF] text-[#6941C6]", Icon: Eye },
  "Waiting for Spec": { cls: "bg-[#FFF4E5] text-[#B54708]", Icon: Clock },
  "Waiting for confirmation": { cls: "bg-[#FFF4E5] text-[#B54708]", Icon: Clock },
  Dependent: { cls: "bg-[#FFF4E5] text-[#B54708]", Icon: Clock },
  Done: { cls: "bg-[#ECFDF3] text-[#027A48]", Icon: CheckCircle2 },
  Blocked: { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
  "Clarification Needed": { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
  "Cant Do": { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
  "CAN'T DO": { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
  "Not Succesfull": { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
  "NOT SUCCESSFUL": { cls: "bg-[#FEF3F2] text-[#B42318]", Icon: AlertTriangle },
};
const DEFAULT_STATUS_TONE = { cls: "bg-[#F2F4F7] text-[#475467]", Icon: Clock };

// Case-insensitive lookup -- real Jira data includes casing variants of the
// same status (e.g. "TESTING" alongside "Testing"; see JIRA_STATUSES'
// "Cant Do"/"CAN'T DO" pairing) that should still render with the same
// tone. The displayed text always stays exactly what's stored -- only the
// tone/icon lookup is case-insensitive.
const statusToneByLowerKey = new Map(
  Object.entries(statusTone).map(([k, v]) => [k.toLowerCase(), v] as const),
);

export function StatusBadge({ status, kind }: { status: string; kind: StatusKind }) {
  const resolved = kind;
  const displayStatus = STATUS_ALIAS[status] ?? status;
  const tone = statusToneByLowerKey.get(displayStatus.toLowerCase()) ?? DEFAULT_STATUS_TONE;
  const Icon = tone.Icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium",
          tone.cls,
        )}
      >
        <Icon className="size-3" />
        {displayStatus}
      </span>
      <span
        title={resolved === "jira" ? "Jira status" : "Stakeholder status"}
        className="rounded bg-[#EEF1F4] px-1 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[#667085] uppercase"
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
    High: { cls: "bg-[#FEEDEC] text-[#D92D20]", Icon: ArrowUp },
    Medium: { cls: "bg-[#FFF4E5] text-[#B54708]", Icon: Minus },
    Low: { cls: "bg-[#ECFDF3] text-[#027A48]", Icon: ArrowDown },
  } as const;
  const { cls, Icon } = map[priority];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="size-3" />
      {priority}
    </span>
  );
}

// Request Type badges, per the UI refinement spec's §4 colors. Client
// Onboarding isn't in the spec (only the 3 feature-kind types are shown in
// the reference screenshot); given a distinct tone consistent with the rest
// of the palette rather than left unstyled.
const requestTypeTone: Record<RequestType, { cls: string; Icon: LucideIcon }> = {
  product_bug: { cls: "bg-[#FFF0EE] text-[#D92D20]", Icon: Wrench },
  product_enhancement: { cls: "bg-[#F2ECFF] text-[#6941C6]", Icon: Sparkles },
  new_request: { cls: "bg-[#EAF4FF] text-[#075A8C]", Icon: Plus },
  client_onboarding: { cls: "bg-[#ECFDF3] text-[#027A48]", Icon: UserPlus },
};

export function RequestTypeBadge({ type }: { type: RequestType | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  const { cls, Icon } = requestTypeTone[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="size-3" />
      {requestTypeLabel(type)}
    </span>
  );
}

export function ProjectBadge({ code }: { code: string }) {
  return (
    <span className="rounded bg-[#E4F0FA] px-[5px] py-[3px] font-mono text-[9px] font-bold tracking-wide text-[#075A8C]">
      {code}
    </span>
  );
}

// Created By avatar + name, per the UI refinement spec's §4 ("Created By:
// reuse existing avatar/user pattern -- Avatar 24x24px circular, background
// #E9E7FF, text #344054") and matching the reference screenshot's table.
export function CreatedByCell({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#E9E7FF] text-[10px] font-semibold text-[#344054]">
        {initial}
      </span>
      <span className="text-[12px] text-[#344054]">{name}</span>
    </span>
  );
}
