import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AllocationBar,
  Avatar,
  AvatarStack,
  Chip,
  DateRangeFilter,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  StatCard,
} from "@/components/dashboard/primitives";
import { PersonAllocationCard } from "@/components/dashboard/work";
import { QueryBoundary } from "@/components/dashboard/query-state";
import {
  toHealth,
  useOrgMetrics,
  usePeople,
  useProjectContributors,
  useProjects,
  useTeams,
  type OrgMetrics,
  type PersonRow,
  type ProjectContributorRow,
  type ProjectRow,
} from "@/data/queries";
import type { Health } from "@/data/dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/resource-planning")({
  head: () => ({
    meta: [
      { title: "Resource Planning — Capacity & Allocation" },
      {
        name: "description",
        content:
          "See who has bandwidth, who is overloaded, and how engineering capacity is distributed across teams and projects.",
      },
      { property: "og:title", content: "Resource Planning — Capacity & Allocation" },
      {
        property: "og:description",
        content: "Who has bandwidth, who is overloaded and where capacity is going.",
      },
    ],
  }),
  component: ResourcePlanning,
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function worstHealth(members: PersonRow[]): Health {
  if (members.some((p) => p.health === "at_risk")) return "At Risk";
  if (members.some((p) => p.health === "needs_attention")) return "Needs Attention";
  return "On Track";
}

function ResourcePlanning() {
  const orgMetrics = useOrgMetrics();
  const people = usePeople();
  const projects = useProjects();
  const teams = useTeams();
  const contributors = useProjectContributors();

  const isLoading =
    orgMetrics.isLoading ||
    people.isLoading ||
    projects.isLoading ||
    teams.isLoading ||
    contributors.isLoading;
  const firstError =
    orgMetrics.error || people.error || projects.error || teams.error || contributors.error;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Resource Planning"
        question="Who is working on what, and where is engineering time going?"
      >
        <DateRangeFilter value="all" onChange={() => {}} disabled />
      </PageHeader>

      <QueryBoundary
        isLoading={isLoading}
        isError={!!firstError}
        error={firstError as Error | null}
      >
        {orgMetrics.data && people.data && projects.data && teams.data && contributors.data && (
          <ResourcePlanningBody
            m={orgMetrics.data}
            people={people.data}
            projects={projects.data}
            teams={teams.data}
            contributors={contributors.data}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

function ResourcePlanningBody({
  m,
  people,
  projects,
  teams,
  contributors,
}: {
  m: OrgMetrics;
  people: PersonRow[];
  projects: ProjectRow[];
  teams: { id: string; name: string }[];
  contributors: ProjectContributorRow[];
}) {
  // Only 38 of ~130 synced projects are "current" (recent epic activity);
  // the rest are historical clusters that would otherwise flood this tab.
  const currentProjects = projects.filter((p) => p.is_current);
  const overallocated = people.filter((p) => p.utilisation_pct > 100);
  const offPlan = currentProjects.filter((p) => p.health !== "on_track");

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const contributorsByProject = new Map<string, ProjectContributorRow[]>();
  for (const c of contributors) {
    if (!contributorsByProject.has(c.project_id)) contributorsByProject.set(c.project_id, []);
    contributorsByProject.get(c.project_id)!.push(c);
  }

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Average Utilisation"
          value={`${m.avg_utilisation}%`}
          sub="Across all engineers"
          tone={m.avg_utilisation > 95 ? "warning" : "neutral"}
        />
        <StatCard
          label="Available Capacity"
          value={`${m.available_hours}h`}
          sub="Free hours this sprint"
          tone="success"
        />
        <StatCard
          label="Overallocated People"
          value={overallocated.length}
          sub={overallocated.map((p) => p.name).join(", ") || "None"}
          tone="danger"
        />
        <StatCard
          label="Active Projects"
          value={m.active_projects}
          sub={`${offPlan.length} off plan`}
        />
      </section>

      <Tabs defaultValue="teams">
        <TabsList>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
        </TabsList>

        <TabsContent value="teams" className="mt-6 space-y-4">
          {teams.map((team) => (
            <TeamCard key={team.id} teamName={team.name} people={people} />
          ))}
        </TabsContent>

        <TabsContent value="people" className="mt-6 space-y-4">
          {people.map((p) => (
            <PersonAllocationCard key={p.id} person={p} />
          ))}
        </TabsContent>

        <TabsContent value="projects" className="mt-6 grid gap-4 lg:grid-cols-2">
          {currentProjects.map((project) => {
            const rawOwners = contributorsByProject.get(project.id) ?? [];
            const owners = rawOwners
              .map((o) => ({ ...o, person: peopleById.get(o.person_id) }))
              .filter((o): o is ProjectContributorRow & { person: PersonRow } => !!o.person)
              .sort((a, b) => b.hours - a.hours);
            // pct on project_contributors is "% of this person's own time"
            // (matches the raw allocation shown on their People card), so
            // summing it across contributors is the project's combined
            // footprint -- it can run over 100%. "share" below is the
            // separate, normalized "% of this project's tracked hours"
            // figure used for the ownership bar/list, which does sum to 100.
            const totalAllocation = owners.reduce((s, o) => s + o.pct, 0);
            const totalHours = owners.reduce((s, o) => s + o.hours, 0);
            const ownersWithShare = owners.map((o) => ({
              ...o,
              share: totalHours > 0 ? Math.round((o.hours / totalHours) * 100) : 0,
            }));
            const teamNames = Array.from(
              new Set(owners.map((o) => o.person.team).filter((t): t is string => !!t)),
            );

            return (
              <article key={project.id} className="card-soft card-hover p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: project.color ?? "var(--chart-1)" }}
                    />
                    <h3 className="font-semibold">{project.name}</h3>
                  </div>
                  <HealthBadge health={toHealth(project.health)} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KeyValue label="Total allocation" value={`${totalAllocation}%`} />
                  <KeyValue label="Hours invested" value={`${project.hours_invested}h`} />
                  <KeyValue label="Remaining" value={`${project.remaining_estimate_hours}h`} />
                  <KeyValue label="Headcount" value={owners.length} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KeyValue label="Open tickets" value={project.open_tickets} />
                  <KeyValue label="Closed tickets" value={project.closed_tickets} />
                  <KeyValue
                    label="Blocked"
                    value={project.blocked_tickets}
                    tone={project.blocked_tickets ? "danger" : "success"}
                  />
                  <KeyValue label="Teams" value={teamNames.length} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {teamNames.map((t) => (
                    <Chip key={t} tone="info">
                      {t}
                    </Chip>
                  ))}
                </div>
                <div className="mt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Project ownership
                  </p>
                  <AllocationBar
                    segments={ownersWithShare.map((o, i) => ({
                      label: o.person.name,
                      pct: o.share,
                      hours: o.hours,
                      color: `var(--chart-${(i % 6) + 1})`,
                    }))}
                  />
                  <ul className="mt-3 space-y-1.5">
                    {ownersWithShare.map((o, i) => (
                      <li key={o.person.id} className="flex items-center gap-2 text-sm">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: `var(--chart-${(i % 6) + 1})` }}
                        />
                        <span className="flex-1">{o.person.name}</span>
                        <span className="num font-semibold">{o.share}%</span>
                        <span className="num w-14 text-right text-xs text-muted-foreground">
                          {o.hours}h
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  to="/projects"
                  search={{ project: project.slug }}
                  className="mt-4 inline-block text-sm font-medium text-info hover:underline"
                >
                  Open project workspace
                </Link>
              </article>
            );
          })}
        </TabsContent>
      </Tabs>
    </>
  );
}

function TeamCard({ teamName, people }: { teamName: string; people: PersonRow[] }) {
  const [open, setOpen] = useState(false);
  const members = people.filter((p) => p.team === teamName);
  const headcount = members.length;
  const avgUtil = headcount
    ? Math.round(members.reduce((s, p) => s + p.utilisation_pct, 0) / headcount)
    : 0;
  const avgBandwidth = headcount
    ? Math.round(members.reduce((s, p) => s + p.bandwidth_hours, 0) / headcount)
    : 0;
  const risk = worstHealth(members);
  const avatarPeople = members.map((p) => ({ name: p.name, initials: initials(p.name) }));

  return (
    <div className="card-soft overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-5 px-5 py-4 text-left hover:bg-secondary/40"
      >
        <div className="min-w-[12rem] flex-1">
          <h3 className="font-semibold">{teamName}</h3>
          <p className="text-xs text-muted-foreground">{headcount} engineers</p>
        </div>
        <div className="w-44">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Avg utilisation</span>
            <span className="num">{avgUtil}%</span>
          </div>
          <Meter value={avgUtil} />
        </div>
        <div className="w-32">
          <p className="text-xs text-muted-foreground">Avg bandwidth</p>
          <p className={cn("num font-semibold", avgBandwidth < 0 ? "text-danger" : "text-success")}>
            {avgBandwidth}h
          </p>
        </div>
        <HealthBadge health={risk} />
        <AvatarStack people={avatarPeople} />
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border bg-secondary/20">
          {members.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <Avatar person={{ name: p.name, initials: initials(p.name) }} size="sm" />
              <div className="min-w-[10rem] flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.role ?? "Engineer"}</p>
              </div>
              <div className="w-40">
                <Meter value={p.utilisation_pct} />
              </div>
              <span className="num w-14 text-sm font-semibold">{p.utilisation_pct}%</span>
              <span
                className={cn(
                  "num w-14 text-sm",
                  p.bandwidth_hours < 0 ? "text-danger" : "text-success",
                )}
              >
                {p.bandwidth_hours}h
              </span>
              <HealthBadge health={toHealth(p.health)} />
              <Link
                to="/people"
                search={{ q: "", person: p.id }}
                className="ml-auto text-sm font-medium text-info hover:underline"
              >
                Profile
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
