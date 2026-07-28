import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AllocationBar,
  Avatar,
  AvatarStack,
  Chip,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  StatCard,
  StatusPill,
} from "@/components/dashboard/primitives";
import {
  contributorsOf,
  orgMetrics,
  ownershipOf,
  people,
  projectById,
  projects,
  teams,
  teamStats,
} from "@/data/dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/resource-planning")({
  head: () => ({
    meta: [
      { title: "Resource Planning — Capacity & Allocation" },
      {
        name: "description",
        content: "See who has bandwidth, who is overloaded, and how engineering capacity is distributed across teams and projects.",
      },
      { property: "og:title", content: "Resource Planning — Capacity & Allocation" },
      { property: "og:description", content: "Who has bandwidth, who is overloaded and where capacity is going." },
    ],
  }),
  component: ResourcePlanning,
});

function ResourcePlanning() {
  const m = orgMetrics;
  return (
    <div className="space-y-8">
      <PageHeader title="Resource Planning" question="Who is working on what, and where is engineering time going?" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Average Utilisation" value={`${m.avgUtil}%`} sub="Across all engineers" tone={m.avgUtil > 95 ? "warning" : "neutral"} />
        <StatCard label="Available Capacity" value={`${m.availableHours}h`} sub="Free hours this sprint" tone="success" />
        <StatCard label="Overallocated People" value={m.overallocated.length} sub={m.overallocated.map((p) => p.name).join(", ")} tone="danger" />
        <StatCard label="Active Projects" value={m.activeProjects} sub={`${projects.filter((p) => p.health !== "On Track").length} off plan`} />
      </section>

      <Tabs defaultValue="teams">
        <TabsList>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
        </TabsList>

        <TabsContent value="teams" className="mt-6 space-y-4">
          {teams.map((team) => (
            <TeamCard key={team} team={team} />
          ))}
        </TabsContent>

        <TabsContent value="people" className="mt-6 space-y-4">
          {people.map((p) => (
            <PersonAllocationCard key={p.id} personId={p.id} />
          ))}
        </TabsContent>

        <TabsContent value="projects" className="mt-6 grid gap-4 lg:grid-cols-2">
          {projects.map((project) => {
            const owners = ownershipOf(project.id);
            const totalAllocation = owners.reduce((s, o) => s + o.pct, 0);
            return (
              <article key={project.id} className="card-soft card-hover p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                    <h3 className="font-semibold">{project.name}</h3>
                  </div>
                  <HealthBadge health={project.health} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KeyValue label="Total allocation" value={`${totalAllocation}%`} />
                  <KeyValue label="Hours invested" value={`${project.hoursInvested}h`} />
                  <KeyValue label="Remaining" value={`${project.remainingEstimate}h`} />
                  <KeyValue label="Headcount" value={owners.length} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KeyValue label="Open tickets" value={project.openTickets} />
                  <KeyValue label="Closed tickets" value={project.closedTickets} />
                  <KeyValue label="Blocked" value={project.blockedTickets} tone={project.blockedTickets ? "danger" : "success"} />
                  <KeyValue label="Teams" value={project.teams.length} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.teams.map((t) => (
                    <Chip key={t} tone="info">
                      {t}
                    </Chip>
                  ))}
                </div>
                <div className="mt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Project ownership</p>
                  <AllocationBar
                    segments={owners.map((o, i) => ({
                      label: o.person.name,
                      pct: o.share,
                      hours: o.hours,
                      color: `var(--chart-${(i % 6) + 1})`,
                    }))}
                  />
                  <ul className="mt-3 space-y-1.5">
                    {owners.map((o, i) => (
                      <li key={o.person.id} className="flex items-center gap-2 text-sm">
                        <span className="size-2 rounded-full" style={{ backgroundColor: `var(--chart-${(i % 6) + 1})` }} />
                        <span className="flex-1">{o.person.name}</span>
                        <span className="num font-semibold">{o.share}%</span>
                        <span className="num w-14 text-right text-xs text-muted-foreground">{o.hours}h</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  to="/projects"
                  search={{ project: project.id }}
                  className="mt-4 inline-block text-sm font-medium text-info hover:underline"
                >
                  Open project workspace
                </Link>
              </article>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TeamCard({ team }: { team: string }) {
  const [open, setOpen] = useState(false);
  const s = teamStats(team);
  return (
    <div className="card-soft overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-5 px-5 py-4 text-left hover:bg-secondary/40">
        <div className="min-w-[12rem] flex-1">
          <h3 className="font-semibold">{team}</h3>
          <p className="text-xs text-muted-foreground">{s.headcount} engineers</p>
        </div>
        <div className="w-44">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Avg utilisation</span>
            <span className="num">{s.avgUtil}%</span>
          </div>
          <Meter value={s.avgUtil} />
        </div>
        <div className="w-32">
          <p className="text-xs text-muted-foreground">Avg bandwidth</p>
          <p className={cn("num font-semibold", s.avgBandwidth < 0 ? "text-danger" : "text-success")}>{s.avgBandwidth}h</p>
        </div>
        <HealthBadge health={s.risk} />
        <AvatarStack people={s.members} />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border bg-secondary/20">
          {s.members.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <Avatar person={p} size="sm" />
              <div className="min-w-[10rem] flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.role}</p>
              </div>
              <div className="w-40">
                <Meter value={p.utilisation} />
              </div>
              <span className="num w-14 text-sm font-semibold">{p.utilisation}%</span>
              <span className={cn("num w-14 text-sm", p.bandwidthHours < 0 ? "text-danger" : "text-success")}>{p.bandwidthHours}h</span>
              <HealthBadge health={p.health} />
              <Link to="/people" search={{ q: "", person: p.id }} className="ml-auto text-sm font-medium text-info hover:underline">
                Profile
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PersonAllocationCard({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const p = people.find((x) => x.id === personId)!;
  return (
    <article className="card-soft card-hover">
      <div className="grid gap-5 p-5 lg:grid-cols-[16rem_1fr_14rem]">
        <div className="flex items-center gap-3">
          <Avatar person={p} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.name}</p>
            <p className="text-sm text-muted-foreground">{p.role}</p>
            <Chip className="mt-1">{p.team}</Chip>
          </div>
        </div>

        <div>
          <AllocationBar
            segments={p.allocations.map((a) => ({
              label: projectById(a.projectId).name,
              pct: a.pct,
              hours: a.hours,
              color: projectById(a.projectId).color,
            }))}
            height="h-4"
          />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {p.allocations.map((a) => (
              <li key={a.projectId} className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full" style={{ backgroundColor: projectById(a.projectId).color }} />
                <span className="flex-1 truncate">{projectById(a.projectId).name}</span>
                <span className="num font-semibold">{a.pct}%</span>
                <span className="num w-12 text-right text-xs text-muted-foreground">{a.hours}h</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Utilisation</span>
            <span className="num font-semibold">{p.utilisation}%</span>
          </div>
          <Meter value={p.utilisation} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bandwidth</span>
            <span className={cn("num font-semibold", p.bandwidthHours < 0 ? "text-danger" : "text-success")}>{p.bandwidthHours}h</span>
          </div>
          <HealthBadge health={p.health} />
          {p.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {p.riskFlags.map((f) => (
                <Chip key={f} tone="danger">
                  {f}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
      >
        {open ? "Hide detail" : "Show work detail"}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid gap-6 border-t border-border bg-secondary/20 p-5 lg:grid-cols-3">
          <TicketList title="Current tickets" tickets={p.current} />
          <TicketList title="Upcoming work" tickets={p.upcoming} />
          <div className="space-y-4">
            <TicketList title="Recently completed" tickets={p.completed} />
            <div className="grid grid-cols-2 gap-3">
              <KeyValue label="Hours logged" value={`${p.hoursLogged}h`} />
              <KeyValue label="Estimated hours" value={`${p.estimatedHours}h`} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function TicketList({ title, tickets }: { title: string; tickets: import("@/data/dashboard").Ticket[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.key} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="num text-xs font-semibold text-muted-foreground">{t.key}</span>
                <StatusPill status={t.status} />
              </div>
              <p className="mt-1 text-sm">{t.title}</p>
              <p className="num mt-1 text-xs text-muted-foreground">
                {projectById(t.projectId).name} · est {t.estimate ?? "—"}h · logged {t.logged}h
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { contributorsOf };