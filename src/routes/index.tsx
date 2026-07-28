import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleSlash,
  GitMerge,
  Rocket,
  TestTube2,
  Activity,
} from "lucide-react";
import {
  AllocationBar,
  Avatar,
  AvatarStack,
  Chip,
  HealthBadge,
  Meter,
  PageHeader,
  SectionHeading,
  StatCard,
} from "@/components/dashboard/primitives";
import { QueryBoundary } from "@/components/dashboard/query-state";
import {
  useOrgMetrics,
  usePeople,
  useProjects,
  useRecentActivity,
  useTopRisks,
  toHealth,
  type PersonRow,
  type ProjectRow,
} from "@/data/queries";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/supabase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Engineering Overview — Delivery, Capacity & Health" },
      {
        name: "description",
        content:
          "Executive summary of engineering delivery: sprint progress, capacity, projects at risk and board health in one screen.",
      },
      { property: "og:title", content: "Engineering Overview — Delivery, Capacity & Health" },
      {
        property: "og:description",
        content: "Sprint progress, capacity, projects at risk and board health in one screen.",
      },
    ],
  }),
  component: Overview,
});

const activityIcon = {
  released: Rocket,
  completed: CheckCircle2,
  blocked: CircleSlash,
  qa: TestTube2,
  merged: GitMerge,
  update: Activity,
};

function personInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

// Per-person allocations aren't on v_people_overview (that view is a flat
// rollup); fetch them in bulk once for the "people requiring attention"
// and "available capacity" sections rather than N+1 querying per card.
function useAllAllocations() {
  return useQuery({
    queryKey: ["all-allocations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_person_allocations").select("*");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

function useSprintOverrunCount() {
  return useQuery({
    queryKey: ["sprint-overrun-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("risks")
        .select("*", { count: "exact", head: true })
        .eq("category", "sprint_overrun")
        .eq("status", "open");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

function Overview() {
  const orgMetrics = useOrgMetrics();
  const people = usePeople();
  const projects = useProjects();
  const allocations = useAllAllocations();
  const topRisks = useTopRisks();
  const recentActivity = useRecentActivity();
  const overrunCount = useSprintOverrunCount();

  const isLoading =
    orgMetrics.isLoading || people.isLoading || projects.isLoading || allocations.isLoading;
  const firstError = orgMetrics.error || people.error || projects.error || allocations.error;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Overview"
        question="Is engineering on track, and what needs a decision today?"
      />

      <QueryBoundary
        isLoading={isLoading}
        isError={!!firstError}
        error={firstError as Error | null}
      >
        {orgMetrics.data && people.data && projects.data && allocations.data && (
          <OverviewBody
            m={orgMetrics.data}
            people={people.data}
            projects={projects.data}
            allocations={allocations.data}
            risks={topRisks.data ?? []}
            activity={recentActivity.data ?? []}
            overrunCount={overrunCount.data ?? 0}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

function OverviewBody({
  m,
  people,
  projects,
  allocations,
  risks,
  activity,
  overrunCount,
}: {
  m: NonNullable<ReturnType<typeof useOrgMetrics>["data"]>;
  people: PersonRow[];
  projects: ProjectRow[];
  allocations: {
    person_id: string;
    project_id: string;
    project_name: string;
    project_color: string | null;
    pct: number;
    hours: number;
  }[];
  risks: { title: string }[];
  activity: {
    occurred_at: string;
    text: string;
    kind: keyof typeof activityIcon;
    project_name: string;
  }[];
  overrunCount: number;
}) {
  const attention = [...people]
    .filter((p) => p.health !== "on_track")
    .sort((a, b) => b.utilisation_pct - a.utilisation_pct);
  const available = [...people]
    .filter((p) => p.bandwidth_hours >= 5)
    .sort((a, b) => b.bandwidth_hours - a.bandwidth_hours);
  const allocationsByPerson = new Map<string, typeof allocations>();
  for (const a of allocations) {
    if (!allocationsByPerson.has(a.person_id)) allocationsByPerson.set(a.person_id, []);
    allocationsByPerson.get(a.person_id)!.push(a);
  }
  const atRiskProjects = projects.filter((p) => p.is_current && p.health !== "on_track");
  const currentProjects = projects.filter((p) => p.is_current);
  const overallDeliveryTone =
    atRiskProjects.length === 0 ? "success" : atRiskProjects.length <= 2 ? "warning" : "danger";

  return (
    <>
      {/* Status banner */}
      <section className="card-soft overflow-hidden">
        <div className="grid gap-px bg-border md:grid-cols-3">
          <BannerCell
            label="Overall Delivery Status"
            value={atRiskProjects.length === 0 ? "On Track" : "Needs Attention"}
            tone={overallDeliveryTone}
            hint={`${atRiskProjects.length} of ${currentProjects.length} projects off plan`}
          />
          <BannerCell
            label="Sprints Overrunning"
            value={`${overrunCount} of 5`}
            tone={overrunCount === 0 ? "success" : "warning"}
            hint={
              overrunCount > 0
                ? "Still open past their planned end date"
                : "All tracked sprints in-window"
            }
          />
          <BannerCell
            label="Overall Health"
            value={`${m.board_health_score}/100`}
            tone={m.board_health_score > 80 ? "success" : "warning"}
            hint="Estimate coverage, blocked work and dark WIP combined"
            meter={m.board_health_score}
          />
        </div>
        <div className="border-t border-border bg-secondary/40 px-6 py-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top reasons
          </p>
          <ul className="mt-3 space-y-2">
            {(risks.length ? risks : [{ title: "No open high-priority risks right now" }]).map(
              (r) => (
                <li key={r.title} className="flex items-start gap-2.5 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  {r.title}
                </li>
              ),
            )}
          </ul>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Team Capacity"
          value={`${m.avg_utilisation}%`}
          sub={`Average utilisation across ${people.length} engineers`}
          tone={m.avg_utilisation > 100 ? "danger" : m.avg_utilisation > 90 ? "warning" : "neutral"}
          footer={`${m.overallocated_count} people above 100%`}
        />
        <StatCard
          label="Available Bandwidth"
          value={`${m.available_hours}h`}
          sub="Unallocated hours this window"
          tone="success"
          footer={`${available.length} people can take more work`}
        />
        <StatCard
          label="Projects At Risk"
          value={m.at_risk_projects}
          sub={`of ${m.active_projects} active projects`}
          tone="warning"
          footer={atRiskProjects.map((p) => p.name).join(", ") || "None"}
        />
        <StatCard
          label="Board Health"
          value={`${m.board_health_score}`}
          sub={`${m.estimate_coverage}% estimate coverage`}
          tone={m.board_health_score > 80 ? "success" : "warning"}
          footer={`${m.blocked_count} blocked tickets · ${m.dark_wip} dark WIP`}
        />
      </section>

      {/* People requiring attention */}
      <section>
        <SectionHeading
          title="People requiring attention"
          description="Who is overloaded, and what is pulling them under."
          action={
            <Link
              to="/people"
              search={{ q: "", person: "" }}
              className="text-sm font-medium text-info hover:underline"
            >
              All people
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {attention.map((p) => {
            const personAllocations = allocationsByPerson.get(p.id) ?? [];
            return (
              <article key={p.id} className="card-soft card-hover p-5">
                <div className="flex items-start gap-3">
                  <Avatar person={{ name: p.name, initials: personInitials(p.name) }} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate font-semibold">{p.name}</h3>
                      <HealthBadge health={toHealth(p.health)} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {p.role ?? "Engineer"} · {p.team ?? "Unassigned team"}
                      {p.team_guessed && <span className="text-warning"> (guessed)</span>}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Allocation
                    </p>
                    <p className="num font-semibold">{p.utilisation_pct}%</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Bandwidth
                    </p>
                    <p
                      className={`num font-semibold ${p.bandwidth_hours < 0 ? "text-danger" : "text-success"}`}
                    >
                      {p.bandwidth_hours}h
                    </p>
                  </div>
                </div>
                {personAllocations.length > 0 && (
                  <div className="mt-4">
                    <AllocationBar
                      segments={personAllocations.map((a) => ({
                        label: a.project_name,
                        pct: a.pct,
                        hours: a.hours,
                        color: a.project_color || "var(--chart-1)",
                      }))}
                    />
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {personAllocations.map((a) => (
                        <span key={a.project_id} className="inline-flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: a.project_color || undefined }}
                          />
                          {a.project_name} {a.pct}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {p.risk_flags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {p.risk_flags.map((f) => (
                      <Chip key={f} tone="danger">
                        {f}
                      </Chip>
                    ))}
                  </div>
                )}
                <Link
                  to="/people"
                  search={{ q: "", person: p.id }}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-info hover:underline"
                >
                  View details <ArrowUpRight className="size-3.5" />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      {/* Available capacity */}
      <section>
        <SectionHeading
          title="Available capacity"
          description="Who can take more work this sprint."
        />
        <div className="card-soft divide-y divide-border">
          {available.map((p) => {
            const personAllocations = allocationsByPerson.get(p.id) ?? [];
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar person={{ name: p.name, initials: personInitials(p.name) }} />
                <div className="min-w-[10rem] flex-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.role ?? "Engineer"} · {p.team ?? "Unassigned team"}
                  </p>
                </div>
                <div className="w-40">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Allocation</span>
                    <span className="num">{p.utilisation_pct}%</span>
                  </div>
                  <Meter value={p.utilisation_pct} />
                </div>
                <div className="w-28">
                  <p className="text-xs text-muted-foreground">Available</p>
                  <p className="num font-semibold text-success">{p.bandwidth_hours}h</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {personAllocations.map((a) => (
                    <Chip key={a.project_id}>{a.project_name}</Chip>
                  ))}
                </div>
                <Link
                  to="/people"
                  search={{ q: "", person: p.id }}
                  className="ml-auto text-sm font-medium text-info hover:underline"
                >
                  View details
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Projects */}
      <section>
        <SectionHeading
          title="Project overview"
          description="What is active, and how healthy is each project."
          action={
            <Link
              to="/projects"
              search={{ project: "" }}
              className="text-sm font-medium text-info hover:underline"
            >
              Project workspace
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          {currentProjects.map((project) => (
            <article key={project.id} className="card-soft card-hover p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: project.color || "var(--chart-1)" }}
                  />
                  <h3 className="font-semibold">{project.name}</h3>
                </div>
                <HealthBadge health={toHealth(project.health)} />
              </div>
              {project.progress !== null && (
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span className="num">{project.progress}%</span>
                  </div>
                  <Meter
                    value={project.progress}
                    tone={project.health === "at_risk" ? "danger" : "success"}
                  />
                </div>
              )}
              {project.sprint_goal && (
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Sprint goal:</span>{" "}
                  {project.sprint_goal}
                </p>
              )}
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Hours / sprint
                  </p>
                  <p className="num font-semibold">{project.hours_this_sprint}h</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</p>
                  <p className="num font-semibold">{project.remaining_estimate_hours}h</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Blocked</p>
                  <p
                    className={`num font-semibold ${project.blocked_tickets ? "text-danger" : "text-success"}`}
                  >
                    {project.blocked_tickets}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  {project.contributor_count} contributors
                </span>
                <Link
                  to="/projects"
                  search={{ project: project.slug }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-info hover:underline"
                >
                  View project <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Activity */}
      <section>
        <SectionHeading
          title="Recent activity"
          description="Newest first — completions, comments and new blockers."
        />
        <ol className="card-soft divide-y divide-border">
          {activity.length === 0 && (
            <li className="px-5 py-6 text-sm text-muted-foreground">
              No recent activity synced yet.
            </li>
          )}
          {activity.map((a, i) => {
            const Icon = activityIcon[a.kind] ?? Activity;
            const tone =
              a.kind === "blocked"
                ? "text-danger"
                : a.kind === "released" || a.kind === "completed"
                  ? "text-success"
                  : "text-info";
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{a.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.occurred_at).toLocaleString()} · {a.project_name}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

function BannerCell({
  label,
  value,
  hint,
  tone,
  meter,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "success" | "warning" | "danger" | "neutral";
  meter?: number;
}) {
  const toneClass = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    neutral: "text-foreground",
  }[tone];
  return (
    <div className="bg-card px-6 py-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`num mt-2 text-3xl font-semibold ${toneClass}`}>{value}</p>
      {meter !== undefined && (
        <Meter className="mt-3" value={meter} tone={tone === "neutral" ? "success" : tone} />
      )}
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
