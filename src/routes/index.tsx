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
import {
  contributorsOf,
  orgMetrics,
  overviewReasons,
  people,
  projectById,
  projects,
  recentActivity,
  sprint,
} from "@/data/dashboard";

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

function Overview() {
  const m = orgMetrics;
  const attention = people.filter((p) => p.health !== "On Track").sort((a, b) => b.utilisation - a.utilisation);
  const available = people.filter((p) => p.bandwidthHours >= 5).sort((a, b) => b.bandwidthHours - a.bandwidthHours);

  return (
    <div className="space-y-10">
      <PageHeader title="Overview" question="Is engineering on track, and what needs a decision today?" />

      {/* Status banner */}
      <section className="card-soft overflow-hidden">
        <div className="grid gap-px bg-border md:grid-cols-3">
          <BannerCell label="Overall Delivery Status" value="Needs Attention" tone="warning" hint="2 of 4 projects off plan" />
          <BannerCell
            label="Sprint Progress"
            value={`${sprint.progress}%`}
            tone="neutral"
            hint={`${sprint.name} · day ${sprint.day} of ${sprint.length}`}
            meter={sprint.progress}
          />
          <BannerCell
            label="Overall Health"
            value={`${m.boardHealth}/100`}
            tone={m.boardHealth > 80 ? "success" : "warning"}
            hint="Board health, down 6 this week"
            meter={m.boardHealth}
          />
        </div>
        <div className="border-t border-border bg-secondary/40 px-6 py-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top reasons</p>
          <ul className="mt-3 space-y-2">
            {overviewReasons.map((r) => (
              <li key={r} className="flex items-start gap-2.5 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Team Capacity"
          value={`${m.avgUtil}%`}
          sub={`Average utilisation across ${people.length} engineers`}
          tone={m.avgUtil > 100 ? "danger" : m.avgUtil > 90 ? "warning" : "neutral"}
          footer={`${m.overallocated.length} people above 100%`}
        />
        <StatCard
          label="Available Bandwidth"
          value={`${m.availableHours}h`}
          sub="Unallocated hours this sprint"
          tone="success"
          footer={`${available.length} people can take more work`}
        />
        <StatCard
          label="Projects At Risk"
          value={m.atRiskProjects.length}
          sub={`of ${projects.length} active projects`}
          tone="warning"
          footer={m.atRiskProjects.map((p) => p.name).join(", ")}
        />
        <StatCard
          label="Board Health"
          value={`${m.boardHealth}`}
          sub={`${m.estimateCoverage}% estimate coverage`}
          tone={m.boardHealth > 80 ? "success" : "warning"}
          footer={`${m.blocked} blocked tickets · ${m.darkWip} dark WIP`}
        />
      </section>

      {/* People requiring attention */}
      <section>
        <SectionHeading
          title="People requiring attention"
          description="Who is overloaded, and what is pulling them under."
          action={
            <Link to="/people" search={{ q: "", person: "" }} className="text-sm font-medium text-info hover:underline">
              All people
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {attention.map((p) => (
            <article key={p.id} className="card-soft card-hover p-5">
              <div className="flex items-start gap-3">
                <Avatar person={p} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <HealthBadge health={p.health} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {p.role} · {p.team}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Allocation</p>
                  <p className="num font-semibold">{p.utilisation}%</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Bandwidth</p>
                  <p className={`num font-semibold ${p.bandwidthHours < 0 ? "text-danger" : "text-success"}`}>
                    {p.bandwidthHours}h
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <AllocationBar
                  segments={p.allocations.map((a) => ({
                    label: projectById(a.projectId).name,
                    pct: a.pct,
                    hours: a.hours,
                    color: projectById(a.projectId).color,
                  }))}
                />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {p.allocations.map((a) => (
                    <span key={a.projectId} className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: projectById(a.projectId).color }} />
                      {projectById(a.projectId).name} {a.pct}%
                    </span>
                  ))}
                </div>
              </div>
              {p.riskFlags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.riskFlags.map((f) => (
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
          ))}
        </div>
      </section>

      {/* Available capacity */}
      <section>
        <SectionHeading title="Available capacity" description="Who can take more work this sprint." />
        <div className="card-soft divide-y divide-border">
          {available.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <Avatar person={p} />
              <div className="min-w-[10rem] flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.role} · {p.team}
                </p>
              </div>
              <div className="w-40">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Allocation</span>
                  <span className="num">{p.utilisation}%</span>
                </div>
                <Meter value={p.utilisation} />
              </div>
              <div className="w-28">
                <p className="text-xs text-muted-foreground">Available</p>
                <p className="num font-semibold text-success">{p.bandwidthHours}h</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.allocations.map((a) => (
                  <Chip key={a.projectId}>{projectById(a.projectId).name}</Chip>
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
          ))}
        </div>
      </section>

      {/* Projects */}
      <section>
        <SectionHeading
          title="Project overview"
          description="What is active, and how healthy is each project."
          action={
            <Link to="/projects" search={{ project: "" }} className="text-sm font-medium text-info hover:underline">
              Project workspace
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => {
            const contributors = contributorsOf(project.id);
            return (
              <article key={project.id} className="card-soft card-hover p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                    <h3 className="font-semibold">{project.name}</h3>
                  </div>
                  <HealthBadge health={project.health} />
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span className="num">{project.progress}%</span>
                  </div>
                  <Meter value={project.progress} tone={project.health === "At Risk" ? "danger" : "success"} />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Sprint goal:</span> {project.sprintGoal}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Hours / sprint</p>
                    <p className="num font-semibold">{project.hoursThisSprint}h</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</p>
                    <p className="num font-semibold">{project.remainingEstimate}h</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Blocked</p>
                    <p className={`num font-semibold ${project.blockedTickets ? "text-danger" : "text-success"}`}>
                      {project.blockedTickets}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                  <div className="flex items-center gap-3">
                    <AvatarStack people={contributors.map((c) => c.person)} />
                    <span className="text-xs text-muted-foreground">{contributors.length} contributors</span>
                  </div>
                  <Link
                    to="/projects"
                    search={{ project: project.id }}
                    className="inline-flex items-center gap-1 text-sm font-medium text-info hover:underline"
                  >
                    View project <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Activity */}
      <section>
        <SectionHeading title="Recent activity" description="Newest first — releases, completions and new blockers." />
        <ol className="card-soft divide-y divide-border">
          {recentActivity.map((a, i) => {
            const Icon = activityIcon[a.kind];
            const tone =
              a.kind === "blocked" ? "text-danger" : a.kind === "released" || a.kind === "completed" ? "text-success" : "text-info";
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{a.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.when} · {projectById(a.projectId).name}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
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
      {meter !== undefined && <Meter className="mt-3" value={meter} tone={tone === "neutral" ? "success" : tone} />}
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}