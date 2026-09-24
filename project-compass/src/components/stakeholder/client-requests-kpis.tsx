// Flat stat tiles above the Client Requests toolbar, per the "Project
// Compass UI refinement" reference screenshot. Deliberately no
// sparklines/mini-charts inside the tiles (the brief explicitly rules those
// out) -- just an icon, the count, and a label. Counts are always computed
// from the full, unfiltered request list so the tiles read as fleet-wide
// totals regardless of what's currently filtered/searched in the table.
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FlaskConical,
  ListChecks,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { ClientRequest } from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

type StatusTile = {
  key: string;
  label: string;
  // Status match is case-insensitive -- real Jira data includes casing
  // variants of the same status (e.g. "TESTING" alongside "Testing"; see
  // badges.tsx's statusToneByLowerKey for the same reasoning).
  status: string;
  cls: string;
  borderCls: string;
  Icon: LucideIcon;
};

const STATUS_TILES: StatusTile[] = [
  {
    key: "todo",
    label: "To Do",
    status: "to do",
    cls: "bg-[#F2ECFF] text-[#6941C6]",
    borderCls: "border-[#E6DBFF]",
    Icon: ListTodo,
  },
  {
    key: "in_progress",
    label: "In Progress",
    status: "in progress",
    cls: "bg-[#FFF4E5] text-[#B54708]",
    borderCls: "border-[#FBE4BE]",
    Icon: RefreshCw,
  },
  {
    key: "completed",
    label: "Completed",
    status: "done",
    cls: "bg-[#ECFDF3] text-[#027A48]",
    borderCls: "border-[#D3F5E3]",
    Icon: CheckCircle2,
  },
  {
    key: "testing",
    label: "Testing",
    status: "testing",
    cls: "bg-[#EAF4FF] text-[#175CD3]",
    borderCls: "border-[#D3E8FE]",
    Icon: FlaskConical,
  },
  {
    key: "blocked",
    label: "Blocked",
    status: "blocked",
    cls: "bg-[#FEF3F2] text-[#B42318]",
    borderCls: "border-[#FBD6D2]",
    Icon: AlertTriangle,
  },
];

function countFor(items: ClientRequest[], status: string) {
  return items.filter((it) => it.status.toLowerCase() === status).length;
}

export function ClientRequestsKpis({
  requests,
  isLoading,
}: {
  requests: ClientRequest[] | undefined;
  isLoading: boolean;
}) {
  const items = requests ?? [];
  const tiles: Omit<StatusTile, "status">[] = [
    {
      key: "total",
      label: "Total Requests",
      cls: "bg-[#EAF4FF] text-[#075A8C]",
      borderCls: "border-[#D3E8FE]",
      Icon: ListChecks,
    },
    ...STATUS_TILES,
  ];
  const counts: Record<string, number> = {
    total: items.length,
    ...Object.fromEntries(STATUS_TILES.map((t) => [t.key, countFor(items, t.status)])),
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className={cn(
            "flex items-center gap-3 rounded-[7px] border bg-card p-3.5",
            tile.borderCls,
          )}
        >
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-[7px]", tile.cls)}>
            <tile.Icon className="size-4.5" />
          </div>
          <div className="min-w-0 leading-tight">
            {isLoading ? (
              <Skeleton className="h-6 w-8" />
            ) : (
              <p className="text-xl font-semibold text-[#161E2B]">{counts[tile.key]}</p>
            )}
            <p className="truncate text-[12px] text-[#667085]">{tile.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
