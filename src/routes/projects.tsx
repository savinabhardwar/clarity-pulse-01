import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  CircleSlash,
  GitMerge,
  Link2,
  Rocket,
  TestTube2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarStack,
  Chip,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  SectionHeading,
  StatusPill,
  PriorityPill,
} from "@/components/dashboard/primitives";
import { contributorsOf, people, projects, type Project } from "@/data/dashboard";

const searchSchema = z.object({ project: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/projects")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Projects — Purpose, Sprint Work & Delivered Capabilities" },
      {
        name: "description",
        content:
          "A project status workspace: why each project exists, what the team is building this sprint and which product capabilities have shipped.",
      },
      { property: "og:title", content: "Projects — Purpose, Sprint Work & Delivered Capabilities" },
      { property: "og:description", content: "Why each project exists, what is happening now and what has shipped." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { project } = Route.useSearch();
  const navigate = useNavigate({ from: "/projects" });
  const openId = project || projects[0].id;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        question="What is each project for, what are we building now, and what have we delivered?"
      >
        <div className="flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate({ search: { project: p.id } })}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                openId === p.id
                  ? "border-foreground/20 bg-card text-foreground shadow-soft"
                  : "border-transparent text-muted-foreground hover:bg-secondary",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="space-y-6">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} defaultOpen={p.id === openId} />
        ))}
      </div>
    </div>
  );
}

const activityIcon = {
  released: Rocket,
  completed: CheckCircle2,
  blocked: CircleSlash,
  qa: TestTube2,
  merged: GitMerge,
  update: Activity,
};

function ProjectCard({ project, defaultOpen }: { project: Project; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const contributors = contributorsOf(project.id);
  const owner = people.find((p) => p.id === project.ownerId)!;
  const totalAllocation = contributors.reduce((s, c) => s + c.pct, 0);

  return (
    <article className="card-soft overflow-hidden">
      {/* header */}
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="size-3 rounded-full" style={{ backgroundColor: project.color }} />
              <h2 className="text-xl font-semibold">{project.name}</h2>
              <HealthBadge health={project.health} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.sprint} · Owner {owner.name} · {contributors.length} contributors · {totalAllocation}% allocated ·{" "}
              <span className="num">{project.hoursInvested}h</span> invested
            </p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="num">{project.progress}%</span>
            </div>
            <Meter value={project.progress} tone={project.health === "At Risk" ? "danger" : "success"} />
            <div className="mt-3 flex items-center justify-end">
              <AvatarStack people={contributors.map((c) => c.person)} />
            </div>
          </div>
        </div>

        {/* purpose + summary */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Purpose</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{project.purpose}</p>
          </div>
          <div className="rounded-xl border border-info/20 bg-info-soft/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-info">Project summary</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{project.summary}</p>
          </div>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Collapse project" : "Expand project"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="space-y-10 border-t border-border bg-secondary/20 p-6">
          {/* Current sprint */}
          <section>
            <SectionHeading title="What are we working on?" description={`${project.sprint} — ${project.sprintGoal}`} />
            <div className="space-y-3">
              {project.initiatives.map((i) => (
                <Initiative key={i.name} initiative={i} />
              ))}
            </div>
          </section>

          {/* Delivered */}
          <section>
            <SectionHeading title="What have we delivered?" description="Product capabilities shipped since the project began." />
            <div className="grid gap-4 md:grid-cols-2">
              {project.delivered.map((d) => (
                <div key={d.name} className="card-soft card-hover p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-semibold">{d.name}</h4>
                    <Chip tone="success">Shipped</Chip>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{d.description}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <KeyValue label="Sprint" value={d.sprint} />
                    <KeyValue label="Completed" value={d.date} />
                    <KeyValue label="Hours" value={`${d.hours}h`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {d.tickets.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Contributors */}
          <section>
            <SectionHeading title="Contributors" description="Who is on this project and how much of them we have." />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {contributors.map((c) => (
                <div key={c.person.id} className="card-soft card-hover p-4">
                  <div className="flex items-center gap-3">
                    <Avatar person={c.person} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.person.name}</p>
                      <p className="text-sm text-muted-foreground">{c.person.role}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <KeyValue label="Allocation" value={`${c.pct}%`} />
                    <KeyValue label="Hours" value={`${c.hours}h`} />
                    <KeyValue
                      label="Bandwidth"
                      value={`${c.person.bandwidthHours}h`}
                      tone={c.person.bandwidthHours < 0 ? "danger" : "success"}
                    />
                    <KeyValue
                      label="Current tickets"
                      value={c.person.current.filter((t) => t.projectId === project.id).length}
                    />
                  </div>
                  <Link
                    to="/people"
                    search={{ q: "", person: c.person.id }}
                    className="mt-3 inline-block text-sm font-medium text-info hover:underline"
                  >
                    View profile
                  </Link>
                </div>
              ))}
            </div>
          </section>

          {/* Metrics */}
          <section>
            <SectionHeading title="Metrics" description="Delivery throughput and remaining work." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <KeyValue label="Total hours" value={`${project.hoursInvested}h`} />
              <KeyValue label="Hours this sprint" value={`${project.hoursThisSprint}h`} />
              <KeyValue label="Velocity" value={`${project.velocity} pts`} />
              <KeyValue label="Completed tickets" value={project.closedTickets} />
              <KeyValue label="Open tickets" value={project.openTickets} />
              <KeyValue label="Blocked" value={project.blockedTickets} tone={project.blockedTickets ? "danger" : "success"} />
              <KeyValue label="Remaining estimate" value={`${project.remainingEstimate}h`} />
            </div>
          </section>

          {/* Risks */}
          <section>
            <SectionHeading title="Risks" description="What needs a decision or an escalation." />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card-soft p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Current blockers</p>
                {project.risks.blockers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open blockers.</p>
                ) : (
                  <ul className="space-y-2">
                    {project.risks.blockers.map((b) => (
                      <li key={b.ticket} className="rounded-lg border border-danger/20 bg-danger-soft/50 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="num text-xs font-semibold">{b.ticket}</span>
                          <PriorityPill priority={b.priority} />
                          <span className="ml-auto text-xs text-muted-foreground">{b.days} days blocked</span>
                        </div>
                        <p className="mt-1 text-sm">{b.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {b.owner} · since {b.since}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-4">
                <div className="card-soft p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Dependencies</p>
                  <ul className="space-y-2">
                    {project.risks.dependencies.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-sm">
                        <Link2 className="mt-0.5 size-4 shrink-0 text-info" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <KeyValue
                    label="Overallocated"
                    value={contributors.filter((c) => c.person.utilisation > 100).length}
                    tone={contributors.some((c) => c.person.utilisation > 100) ? "danger" : "success"}
                  />
                  <KeyValue label="Missing estimates" value={project.risks.missingEstimates} tone="warning" />
                  <KeyValue label="Stale tickets" value={project.risks.staleTickets} tone="warning" />
                </div>
                {contributors.filter((c) => c.person.utilisation > 100).length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft/60 p-3 text-sm">
                    <AlertTriangle className="size-4 text-warning" />
                    {contributors
                      .filter((c) => c.person.utilisation > 100)
                      .map((c) => `${c.person.name} (${c.person.utilisation}%)`)
                      .join(", ")}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <SectionHeading title="Timeline" description="Release history, not ticket history." />
              <ol className="card-soft relative space-y-0 p-5">
                {project.timeline.map((t, i) => (
                  <li key={t.sprint + t.capability} className="relative flex gap-4 pb-6 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className="mt-1 size-2.5 rounded-full ring-4 ring-card"
                        style={{ backgroundColor: i === project.timeline.length - 1 ? "var(--warning)" : project.color }}
                      />
                      {i !== project.timeline.length - 1 && <span className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="-mt-0.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.sprint}</p>
                      <p className="text-sm font-medium">{t.capability}</p>
                      <p className="text-xs text-muted-foreground">{t.date}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <SectionHeading title="Activity" description="Newest first." />
              <ul className="card-soft divide-y divide-border">
                {project.activity.map((a, i) => {
                  const Icon = activityIcon[a.kind];
                  const tone =
                    a.kind === "blocked" ? "text-danger" : a.kind === "released" || a.kind === "completed" ? "text-success" : "text-info";
                  return (
                    <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                      <div>
                        <p className="text-sm">{a.text}</p>
                        <p className="text-xs text-muted-foreground">{a.when}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      )}
    </article>
  );
}

function Initiative({ initiative }: { initiative: Project["initiatives"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-soft overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left hover:bg-secondary/40">
        <div className="min-w-[14rem] flex-1">
          <p className="font-medium">{initiative.name}</p>
          <p className="text-sm text-muted-foreground">{initiative.summary}</p>
        </div>
        <div className="w-40">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="num">{initiative.progress}%</span>
          </div>
          <Meter value={initiative.progress} tone={initiative.progress < 35 ? "warning" : "success"} />
        </div>
        <Chip>{initiative.issues.length} issues</Chip>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border bg-secondary/20">
          {initiative.issues.map((issue) => (
            <li key={issue.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="num text-xs font-semibold text-muted-foreground">{issue.key}</span>
              <span className="min-w-[12rem] flex-1 text-sm">{issue.title}</span>
              <StatusPill status={issue.status} />
              <span className="text-xs text-muted-foreground">{issue.assignee}</span>
              <span className="num text-xs text-muted-foreground">{issue.estimate}h est</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}