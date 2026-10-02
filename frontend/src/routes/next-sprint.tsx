import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/emp/shell";
import { Bar, Metric, Panel, SectionHeader, StatusPill } from "@/components/emp/bits";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OVERSIZED_TICKET_HOURS } from "@/lib/emp-data";
import { useEm } from "@/lib/emp-store";
import {
  buildNextSprintPlan,
  ticketEstimateHours,
  type PersonPlan,
} from "@/lib/next-sprint-engine";
import {
  useCanonicalSprint,
  useNextSprintTickets,
  usePlanningAvailability,
  type NextSprintTicketRow,
} from "@/data/queries";

const title = "Next Sprint Planning";
const description =
  "What's already planned for each board's next sprint, and does it fit the team's capacity?";

export const Route = createFileRoute("/next-sprint")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: NextSprintPage,
});

const loadTone = (pct: number) => (pct >= 100 ? "danger" : pct >= 85 ? "warn" : "primary");

const formatDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function NextSprintPage() {
  const { allPeople, people, filters } = useEm();
  const ticketsQuery = useNextSprintTickets();
  const availabilityQuery = usePlanningAvailability();
  const canonicalSprintQuery = useCanonicalSprint();

  const filtersActive =
    filters.team !== "All" || filters.project !== "All" || filters.employee !== "All";

  const plan = useMemo(
    () =>
      buildNextSprintPlan({
        tickets: ticketsQuery.data ?? [],
        allPeople,
        visiblePeople: people,
        filtersActive,
        availability: availabilityQuery.data ?? [],
        currentSprintEnd: canonicalSprintQuery.data?.[0]?.end_date ?? null,
      }),
    [
      ticketsQuery.data,
      allPeople,
      people,
      filtersActive,
      availabilityQuery.data,
      canonicalSprintQuery.data,
    ],
  );

  const loading =
    ticketsQuery.isLoading || availabilityQuery.isLoading || canonicalSprintQuery.isLoading;
  const error = ticketsQuery.error ?? availabilityQuery.error ?? canonicalSprintQuery.error;

  return (
    <AppShell
      title="Next Sprint Planning"
      description="Is the next sprint planned realistically, and who has room for more?"
    >
      {error ? (
        <Panel>
          <p className="text-sm text-destructive">
            Failed to load next-sprint data: {error.message}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            If this says the table doesn't exist, migration 0069_next_sprint_tickets.sql hasn't been
            applied to this database yet.
          </p>
        </Panel>
      ) : loading ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Loading next sprint…</p>
        </Panel>
      ) : (ticketsQuery.data ?? []).length === 0 ? (
        <Panel>
          <p className="text-sm font-medium">No next sprint has any tickets yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This page reads the tickets already placed in each board's future sprint in Jira. Create
            the next sprint on a board and add tickets to it; they appear here after the next sync.
          </p>
        </Panel>
      ) : (
        <>
          <Kpis plan={plan} />
          <div className="mt-6">
            <BoardsSection plan={plan} />
          </div>
          <div className="mt-6">
            <TeamsSection plan={plan} />
          </div>
          <div className="mt-6">
            <PeopleSection plan={plan} />
          </div>
          <div className="mt-6">
            <AttentionSection plan={plan} />
          </div>
          <div className="mt-6">
            <TicketsSection tickets={plan.tickets} />
          </div>
        </>
      )}
    </AppShell>
  );
}

type Plan = ReturnType<typeof buildNextSprintPlan>;

function Kpis({ plan }: { plan: Plan }) {
  const { totals } = plan;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      <Panel>
        <Metric label="Boards with a next sprint" value={plan.boards.length} />
      </Panel>
      <Panel>
        <Metric label="Tickets planned" value={totals.tickets} />
      </Panel>
      <Panel>
        <Metric
          label="Planned hours"
          value={`${totals.plannedHours}h`}
          sub={totals.noOwnerHours > 0 ? `+ ${totals.noOwnerHours}h with no owner` : undefined}
        />
      </Panel>
      <Panel>
        <Metric label="Capacity (after leave)" value={`${totals.capacityHours}h`} />
      </Panel>
      <Panel>
        <Metric
          label={totals.freeHours < 0 ? "Over-planned by" : "Room for more"}
          value={`${Math.abs(totals.freeHours)}h`}
        />
      </Panel>
    </div>
  );
}

function BoardsSection({ plan }: { plan: Plan }) {
  const anyEstimated = plan.boards.some((b) => b.window.estimated);
  return (
    <Panel>
      <SectionHeader
        title="Next sprints by board"
        hint="Straight from each board's future sprint in Jira"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Board", "Sprint", "Dates", "Tickets", "Planned", "People", "No owner"].map((h) => (
                <th key={h} className="stat-label py-2 pr-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.boards.map((b) => (
              <tr key={b.sprintId} className="border-b border-border/60 last:border-0 align-top">
                <td className="py-2.5 pr-4 font-medium">{b.board}</td>
                <td className="py-2.5 pr-4">
                  {b.sprintName}
                  {b.goal ? <p className="text-xs text-muted-foreground">{b.goal}</p> : null}
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                  {formatDate(b.window.start)} – {formatDate(b.window.end)}
                  {b.window.estimated ? (
                    <span className="text-muted-foreground"> (est.)</span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4 tabular-nums">{b.tickets}</td>
                <td className="py-2.5 pr-4 tabular-nums">{b.plannedHours}h</td>
                <td className="py-2.5 pr-4 tabular-nums">{b.people}</td>
                <td className="py-2.5 pr-4 tabular-nums">{b.noOwner || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyEstimated && (
        <p className="mt-3 text-xs text-muted-foreground">
          Jira hasn't set dates on some of these sprints yet. Estimated dates assume the sprint
          starts the workday after the current sprint ends and runs 10 workdays; leave is checked
          against that window.
        </p>
      )}
    </Panel>
  );
}

function TeamsSection({ plan }: { plan: Plan }) {
  return (
    <div>
      <SectionHeader
        title="Capacity by team"
        hint="Planned estimate vs. 7h × 10 days, minus recorded leave"
      />
      <div className="grid gap-4 md:grid-cols-3">
        {plan.teams.map((t) => (
          <Panel key={t.team}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t.team}</h3>
              <StatusPill
                status={
                  t.loadPct >= 100 ? "At Risk" : t.loadPct >= 85 ? "Needs Attention" : "On Track"
                }
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Metric label="Engineers" value={t.engineers} />
              <Metric label="Capacity" value={`${t.capacityHours}h`} />
              <Metric label="Planned" value={`${t.plannedHours}h`} />
              <Metric
                label={t.freeHours < 0 ? "Over-planned" : "Room for more"}
                value={`${Math.abs(t.freeHours)}h`}
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Bar value={t.loadPct} tone={loadTone(t.loadPct)} />
              <span className="text-sm tabular-nums">{t.loadPct}%</span>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function PeopleSection({ plan }: { plan: Plan }) {
  return (
    <Panel>
      <SectionHeader
        title="Capacity check by person"
        hint="Most loaded first — over-planned and idle people stand out"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {[
                "Employee",
                "Team",
                "Tickets",
                "Planned",
                "Leave",
                "Capacity",
                "Load",
                "Status",
                "Flags",
              ].map((h) => (
                <th key={h} className="stat-label py-2 pr-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.people.map((p) => (
              <PersonRow key={p.id} p={p} />
            ))}
            {plan.people.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-sm text-muted-foreground">
                  No people match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PersonRow({ p }: { p: PersonPlan }) {
  const flags = [
    p.missingEstimates > 0 && `${p.missingEstimates} no estimate`,
    p.oversized > 0 && `${p.oversized} oversized`,
  ].filter(Boolean);
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2.5 pr-4 font-medium">{p.name}</td>
      <td className="py-2.5 pr-4 text-muted-foreground">{p.team}</td>
      <td className="py-2.5 pr-4 tabular-nums">{p.tickets.length}</td>
      <td className="py-2.5 pr-4 tabular-nums">{p.plannedHours}h</td>
      <td className="py-2.5 pr-4 tabular-nums">{p.leaveHours ? `${p.leaveHours}h` : "—"}</td>
      <td className="py-2.5 pr-4 tabular-nums">{p.capacityHours}h</td>
      <td className="py-2.5 pr-4">
        <div className="flex w-36 items-center gap-2">
          <Bar value={p.loadPct} tone={loadTone(p.loadPct)} />
          <span className="w-10 shrink-0 text-right tabular-nums">{p.loadPct}%</span>
        </div>
      </td>
      <td className="py-2.5 pr-4">
        <StatusPill status={p.status} />
      </td>
      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{flags.join(", ") || "—"}</td>
    </tr>
  );
}

function AttentionSection({ plan }: { plan: Plan }) {
  const groups: { label: string; hint: string; tickets: NextSprintTicketRow[] }[] = [
    {
      label: "No owner",
      hint: "Unassigned, or assigned to someone no longer on the roster",
      tickets: plan.noOwner,
    },
    {
      label: "Missing estimate",
      hint: "Can't be counted toward anyone's load until estimated",
      tickets: plan.missingEstimates,
    },
    {
      label: `Over ${OVERSIZED_TICKET_HOURS}h`,
      hint: "Break these down — they're left out of the planned hours above",
      tickets: plan.oversized,
    },
  ];
  const anything = groups.some((g) => g.tickets.length > 0);

  return (
    <Panel>
      <SectionHeader
        title="Fix before the sprint starts"
        hint="Gaps that make the plan above unreliable"
      />
      {!anything ? (
        <p className="text-sm text-muted-foreground">
          Every next-sprint ticket has an owner and a reasonable estimate.
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="stat-label">
                {g.label} <span className="tabular-nums">({g.tickets.length})</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{g.hint}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {g.tickets.length === 0 ? (
                  <li className="text-muted-foreground">None</li>
                ) : (
                  g.tickets.map((t) => (
                    <li key={t.jira_key} className="flex gap-2">
                      <span className="shrink-0 font-medium tabular-nums">{t.jira_key}</span>
                      <span className="truncate text-muted-foreground" title={t.summary}>
                        {t.summary}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TicketsSection({ tickets }: { tickets: NextSprintTicketRow[] }) {
  const [board, setBoard] = useState("All");
  const boards = Array.from(new Set(tickets.map((t) => t.board_name))).sort();
  const shown = tickets
    .filter((t) => board === "All" || t.board_name === board)
    .sort(
      (a, b) => a.board_name.localeCompare(b.board_name) || a.jira_key.localeCompare(b.jira_key),
    );

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Next-sprint tickets{" "}
          <span className="text-muted-foreground tabular-nums">({shown.length})</span>
        </h2>
        <Select value={board} onValueChange={setBoard}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Board" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All boards</SelectItem>
            {boards.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Ticket", "Summary", "Board", "Assignee", "Status", "Estimate"].map((h) => (
                <th key={h} className="stat-label py-2 pr-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const est = ticketEstimateHours(t);
              return (
                <tr key={t.jira_key} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap tabular-nums">
                    {t.jira_key}
                  </td>
                  <td className="py-2.5 pr-4">{t.summary}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.board_name}</td>
                  <td className="py-2.5 pr-4">
                    {t.assignee_name ?? <span className="text-muted-foreground">Unassigned</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.status}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {est == null ? <span className="text-muted-foreground">—</span> : `${est}h`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
