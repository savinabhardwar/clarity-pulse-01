import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/emp/shell";
import { Bar, Metric, Panel, SectionHeader, SeverityDot, StatusPill } from "@/components/emp/bits";
import { useEm, filteredProjects } from "@/lib/emp-store";
import {
  countOpenTicketsByPerson,
  kpis,
  managerActions,
  projectSpaceToTeam,
  teamMetrics,
  toHealth,
} from "@/lib/emp-engine";
import { EXCLUDED_PEOPLE } from "@/lib/emp-data";
import {
  useCanonicalSprint,
  useOpenTickets,
  useTicketHygiene,
  type HygieneRow,
} from "@/data/queries";

const title = "Sprint Dashboard — Delivery Lens Engineering Management";
const description =
  "Sprint health, manager actions, Jira hygiene and project status in one engineering management view.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { people, teamPeople, filters, projects, allocations } = useEm();
  const openTickets = useOpenTickets();
  const hygiene = useTicketHygiene();
  const canonicalSprint = useCanonicalSprint();

  const k = kpis(people);
  const teams = teamMetrics(teamPeople);
  const openTicketCounts = countOpenTicketsByPerson(openTickets.data ?? []);
  const actions = managerActions(people, openTicketCounts);
  const visibleProjects = filteredProjects(filters, projects, allocations)
    .filter((p) => p.is_current && (p.open_tickets > 0 || p.closed_tickets > 0))
    .sort((a, b) => b.remaining_estimate_hours - a.remaining_estimate_hours);
  const sprintName = canonicalSprint.data?.[0]?.name ?? "current sprint";

  const hygieneByPerson = new Map<string, HygieneRow[]>();
  for (const h of hygiene.data ?? []) {
    const name = h.person_name ?? "Unassigned";
    if (EXCLUDED_PEOPLE.has(name)) continue;
    (hygieneByPerson.get(name) ?? hygieneByPerson.set(name, []).get(name)!).push(h);
  }
  const hygieneGroups = [...hygieneByPerson.entries()].sort((a, b) => b[1].length - a[1].length);

  const cards = [
    {
      label: "Total Productive Hours",
      value: `${k.productive}h`,
      sub: "Fixed sprint capacity across the team",
    },
    {
      label: "Allocated Hours",
      value: `${k.allocated}h`,
      sub: "Committed to sprint work (oversized tickets excluded)",
    },
    {
      label: "Unallocated Hours",
      value: `${k.unallocated}h`,
      sub: "Available for additional work",
    },
    { label: "Sprint Spillage", value: `${k.spillage}h`, sub: "Likely to carry into next sprint" },
    { label: "Team Utilisation", value: `${k.utilisation}%`, sub: "Allocated against capacity" },
  ];

  return (
    <AppShell
      title={`Sprint Dashboard — ${sprintName}`}
      description="Are we on track, and what needs your attention today?"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="panel p-4">
            <p className="stat-label">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionHeader
            title="Manager actions"
            hint={`${actions.length} items generated from this sprint's signals`}
          />
          <ul className="divide-y divide-border">
            {actions.map((a, i) => (
              <li key={i} className="flex gap-3 py-3">
                <SeverityDot severity={a.severity} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {a.subject}
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {a.kind}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{a.issue}</p>
                  <p className="mt-1 text-sm font-medium text-primary">{a.action}</p>
                </div>
              </li>
            ))}
            {actions.length === 0 && (
              <li className="py-6 text-sm text-muted-foreground">
                Nothing needs your attention right now.
              </li>
            )}
          </ul>
        </Panel>

        <Panel>
          <SectionHeader
            title="Jira hygiene"
            hint="Tickets missing an estimate, comments, epic or worklog"
          />
          <div className="max-h-[560px] space-y-4 overflow-y-auto">
            {hygiene.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!hygiene.isLoading && hygieneGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Every ticket in view is properly updated.
              </p>
            )}
            {hygieneGroups.map(([personName, tickets]) => (
              <div key={personName} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{personName}</p>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="mt-2 space-y-2">
                  {tickets.map((h) => (
                    <li
                      key={h.ticket_id}
                      className="border-t border-border/60 pt-2 first:border-0 first:pt-0"
                    >
                      <p className="text-xs text-muted-foreground">
                        {h.jira_key} · {h.summary}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-warning-foreground">
                        Missing:{" "}
                        {[
                          h.missing_estimate && "original estimate",
                          h.missing_comments && "comments",
                          h.missing_epic && "epic",
                          h.missing_worklog && "worklog",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-6">
        <SectionHeader title="Team utilisation" hint="Where additional work can be assigned" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[
                  "Team",
                  "Productive",
                  "Allocated",
                  "Unallocated",
                  "Capacity used",
                  "Spillage",
                ].map((h) => (
                  <th key={h} className="stat-label py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.team} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-4 font-medium">{t.team}</td>
                  <td className="py-3 pr-4 tabular-nums">{t.productiveHours}h</td>
                  <td className="py-3 pr-4 tabular-nums">{t.allocatedHours}h</td>
                  <td className="py-3 pr-4 tabular-nums font-medium text-success">
                    {t.unallocatedHours}h
                  </td>
                  <td className="w-52 py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <Bar
                        value={t.capacityUsed}
                        tone={
                          t.capacityUsed >= 100
                            ? "danger"
                            : t.capacityUsed >= 90
                              ? "warn"
                              : "primary"
                        }
                      />
                      <span className="tabular-nums">{t.capacityUsed}%</span>
                    </div>
                  </td>
                  <td className="py-3 tabular-nums">{t.spillage}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-6">
        <SectionHeader title="Project overview" hint="Sorted by hours planned this sprint" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Project", "Status", "Progress", "Planned this sprint", "Investment"].map((h) => (
                  <th key={h} className="stat-label py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-4">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {projectSpaceToTeam(p.project_space)}
                    </p>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={toHealth(p.health)} />
                  </td>
                  <td className="w-44 py-3 pr-4">
                    {p.progress !== null ? (
                      <div className="flex items-center gap-2">
                        <Bar value={p.progress} />
                        <span className="tabular-nums">{p.progress}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not tracked</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{p.remaining_estimate_hours}h</td>
                  <td className="py-3 pr-4 tabular-nums">{p.hours_invested.toLocaleString()}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {teams.map((t) => (
          <Panel key={t.team} className="p-4">
            <Metric
              label={`${t.team} headroom`}
              value={`${t.unallocatedHours}h`}
              sub={`${t.engineers} engineers · ${t.capacityUsed}% capacity used`}
            />
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
