import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/emp/shell";
import { Bar, Metric, Panel, SectionHeader, StatusPill } from "@/components/emp/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useEm } from "@/lib/emp-store";
import type { EmployeeMetrics } from "@/lib/emp-engine";
import {
  usePersonDetail,
  usePersonHistory,
  useTriggerJiraSync,
  type ActiveWorkTicket,
  type PersonDetail,
} from "@/data/queries";

const title = "People — Engineering Team Health & Capacity";
const description =
  "Search, filter and expand every engineer to see sprint pace, active work, tracking gaps and performance history.";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const { people } = useEm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const syncMutation = useTriggerJiraSync();

  const list = useMemo(() => {
    return people
      .filter(
        (p) =>
          !q.trim() ||
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.projects.some((x) => x.toLowerCase().includes(q.toLowerCase())),
      )
      .sort((a, b) => b.spillage - a.spillage || a.pace - b.pace);
  }, [people, q]);

  const handleSync = () => {
    syncMutation.mutate(undefined, {
      onSuccess: () =>
        toast.success("Jira sync triggered", {
          description: "The incremental sync is running now — fresh data lands in a few minutes.",
        }),
      onError: (error) =>
        toast.error("Failed to trigger Jira sync", { description: error.message }),
    });
  };

  return (
    <AppShell title="People" description="Who needs my attention, and who has capacity?">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search people or projects"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-64"
        />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{list.length} people</span>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            disabled={syncMutation.isPending}
            onClick={handleSync}
          >
            <RefreshCw className={`size-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync Jira"}
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {list.map((p) => (
          <PersonCard
            key={p.id}
            p={p}
            open={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
          />
        ))}
        {list.length === 0 && (
          <Panel>
            <p className="text-sm text-muted-foreground">No people match the current filters.</p>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

function trendOf(history: { pace_pct: number }[]): "Improving" | "Stable" | "Declining" {
  if (history.length < 2) return "Stable";
  const delta = history[0]!.pace_pct - history[history.length - 1]!.pace_pct;
  if (delta >= 6) return "Improving";
  if (delta <= -6) return "Declining";
  return "Stable";
}

type DoneTicket = { key: string; title: string; projectName: string | null };

type Drawer = {
  key: string;
  label: string;
  // Tailwind classes for the count badge -- one tint per bucket meaning,
  // reusing the same success/warning/destructive/info tokens StatusPill
  // and the rest of this app already use.
  tone: string;
  tickets: ActiveWorkTicket[];
  doneTickets?: DoneTicket[];
};

// Splits Active work into the buckets a scrum actually asks about, plus a
// cross-cutting "Logged yesterday" drawer up top. status_category only
// distinguishes To Do/in-flight/Done -- "In Progress" vs "QA" vs "Blocked"
// all fall under the same "indeterminate" category, so the split below
// uses the ticket's own raw status text (already present on every
// PersonDetailTicket) instead. Anything indeterminate that isn't
// literally "QA" or "Blocked" is treated as In Progress -- the safe
// default, since silently dropping an unrecognized status would hide
// real work rather than just mis-bucket it.
function buildDrawers(detail: PersonDetail | undefined): Drawer[] {
  const current = detail?.current ?? [];
  const upcoming = detail?.upcoming ?? [];
  const all = [...current, ...upcoming];

  const loggedYesterday = all.filter((t) => t.loggedYesterday > 0);
  const toDo = upcoming;
  const blocked = current.filter((t) => t.status === "Blocked");
  const qa = current.filter((t) => t.status === "QA");
  const inProgress = current.filter((t) => t.status !== "Blocked" && t.status !== "QA");

  const seen = new Set<string>();
  const done: DoneTicket[] = [
    ...(detail?.completedThisSprint ?? []),
    ...(detail?.completed ?? []),
  ].filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));

  return [
    {
      key: "yesterday",
      label: "Logged yesterday",
      tone: "bg-info/15 text-info",
      tickets: loggedYesterday,
    },
    { key: "todo", label: "To Do", tone: "bg-secondary text-secondary-foreground", tickets: toDo },
    {
      key: "in-progress",
      label: "In Progress",
      tone: "bg-primary/15 text-primary",
      tickets: inProgress,
    },
    { key: "qa", label: "QA", tone: "bg-warning/15 text-warning-foreground", tickets: qa },
    {
      key: "blocked",
      label: "Blocked",
      tone: "bg-destructive/15 text-destructive",
      tickets: blocked,
    },
    {
      key: "done",
      label: "Done",
      tone: "bg-success/15 text-success",
      tickets: [],
      doneTickets: done,
    },
  ];
}

function WorkItemRow({ t }: { t: ActiveWorkTicket }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm transition-colors hover:border-border hover:bg-secondary/30">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">{t.key}</span>{" "}
        <span className="font-medium">{t.title}</span>
        {t.projectName && (
          <span className="ml-2 text-xs text-muted-foreground">· {t.projectName}</span>
        )}
        {!t.isAssignee && (
          <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            Handed off
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs tabular-nums text-muted-foreground">
        {t.loggedYesterday > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 font-semibold text-info">
            <Clock className="size-3" />
            {t.loggedYesterday}h yesterday
          </span>
        )}
        <span>{t.estimate ?? 0}h planned</span>
        <span className="font-semibold text-foreground">{t.logged}h logged</span>
      </div>
    </div>
  );
}

function DoneRow({ t }: { t: DoneTicket }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">{t.key}</span>{" "}
        <span className="font-medium">{t.title}</span>
        {t.projectName && (
          <span className="ml-2 text-xs text-muted-foreground">· {t.projectName}</span>
        )}
      </div>
    </div>
  );
}

function DrawerAccordion({ drawers }: { drawers: Drawer[] }) {
  return (
    <Accordion type="multiple" defaultValue={["yesterday"]} className="space-y-2">
      {drawers.map((d) => {
        const count = d.doneTickets ? d.doneTickets.length : d.tickets.length;
        return (
          <AccordionItem
            key={d.key}
            value={d.key}
            className="overflow-hidden rounded-lg border border-border bg-surface last:border-b"
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{d.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${d.tone}`}
                >
                  {count}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4">
              {count === 0 ? (
                <p className="pb-1 text-sm text-muted-foreground">Nothing here.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.doneTickets
                    ? d.doneTickets.map((t) => <DoneRow key={t.key} t={t} />)
                    : d.tickets.map((t) => <WorkItemRow key={t.key} t={t} />)}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function PersonCard({
  p,
  open,
  onToggle,
}: {
  p: EmployeeMetrics;
  open: boolean;
  onToggle: () => void;
}) {
  const detail = usePersonDetail(p.id, open);
  const history = usePersonHistory(p.id, open);
  const historyRows = [...(history.data ?? [])].reverse();
  const trend = trendOf(history.data ?? []);

  return (
    <article className="panel overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 p-4 text-left hover:bg-secondary/40"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
          {p.name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{p.name}</p>
            <span className="text-xs text-muted-foreground">
              {p.role} · {p.team}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.projects.join(" · ") || "No current allocation"}
          </p>
        </div>
        <div className="hidden gap-8 md:flex">
          <Metric label="Sprint pace" value={`${p.pace}%`} />
          <Metric
            label="Remaining"
            value={
              <span className={p.spillage > 0 ? "text-destructive" : "text-success"}>
                {p.remainingWorkHours}h
              </span>
            }
            sub={`${p.daysRemaining} workday${p.daysRemaining === 1 ? "" : "s"} left`}
          />
          <Metric
            label="Spillage"
            value={
              <span className={p.spillage > 0 ? "text-destructive" : "text-success"}>
                {p.spillage}h
              </span>
            }
          />
          <Metric
            label="Bandwidth"
            value={`${Math.max(0, p.remainingCapacity)}h`}
            sub="Free capacity in the time left"
          />
        </div>
        <ChevronDown
          className={"size-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>

      {open && (
        <div className="space-y-6 border-t border-border bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="stat-label">Current projects</p>
              <p className="mt-1 text-sm">{p.projects.join(", ") || "None"}</p>
            </div>
            <div>
              <p className="stat-label">Sprint progress</p>
              <div className="mt-2 flex items-center gap-2">
                <Bar
                  value={p.pace}
                  tone={p.pace < 75 ? "danger" : p.pace < 90 ? "warn" : "primary"}
                />
                <span className="text-sm tabular-nums">{p.pace}%</span>
              </div>
            </div>
            <div>
              <p className="stat-label">Planning accuracy</p>
              <div className="mt-2 flex items-center gap-2">
                <Bar value={p.planningAccuracy} />
                <span className="text-sm tabular-nums">{p.planningAccuracy}%</span>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="Work" hint="Yesterday, then To Do through Done" />
            {detail.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <DrawerAccordion drawers={buildDrawers(detail.data)} />
            )}
          </div>

          <div>
            <SectionHeader title="Work tracking" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label="Last updated"
                value={p.lastUpdatedDays === 0 ? "Today" : `${p.lastUpdatedDays}d ago`}
              />
              <Metric label="Missing estimates" value={p.missingEstimates} />
              <Metric label="Missing worklogs" value={p.missingWorklogs} />
              <Metric label="Stale work items" value={p.staleItems} />
            </div>
          </div>

          <div>
            <SectionHeader
              title="Availability"
              hint="Recorded leave adjusts capacity across every module"
            />
            <div className="grid grid-cols-3 gap-4">
              <Metric label="Unavailable hours" value={`${p.unavailableHours}h`} />
              <Metric label="Adjusted capacity" value={`${p.productiveHours}h`} />
              <Metric label="Remaining capacity" value={`${p.remainingCapacity}h`} />
            </div>
            {p.leaveNote && <p className="mt-2 text-xs text-muted-foreground">{p.leaveNote}</p>}
          </div>

          {p.oversizedTickets.length > 0 && (
            <div className="rounded-md border border-border bg-card p-4">
              <p className="stat-label">
                Needs breakdown — excluded from allocated/logged hours above
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {p.oversizedTickets.map((t) => (
                  <li key={t.key}>
                    <span className="text-xs text-muted-foreground">{t.key}</span> {t.title}{" "}
                    <span className="text-xs font-medium text-warning-foreground">
                      ({t.estimateHours}h estimate)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionHeader title="Performance history" hint={`Trend: ${trend}`} />
            {history.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Synced", "Sprint pace", "Remaining capacity", "Planning accuracy"].map(
                        (h) => (
                          <th key={h} className="stat-label py-2 pr-4">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((hst) => (
                      <tr key={hst.computed_at} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium">
                          {new Date(hst.computed_at).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 pr-4 tabular-nums">{hst.pace_pct}%</td>
                        <td className="py-2.5 pr-4 tabular-nums">{hst.bandwidth_hours}h</td>
                        <td className="py-2.5 text-muted-foreground tabular-nums">
                          {hst.estimate_accuracy ?? "—"}%
                        </td>
                      </tr>
                    ))}
                    {historyRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-sm text-muted-foreground">
                          No historical snapshots yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3">
              <StatusPill status={trend} />
            </div>
          </div>

          {p.riskFlags.length > 0 && (
            <div className="rounded-md border border-border bg-card p-4">
              <p className="stat-label">Risk flags</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {p.riskFlags.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
