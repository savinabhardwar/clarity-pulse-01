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
  Rocket,
  TestTube2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarStack,
  Chip,
  DateRangeFilter,
  dateRangeToIso,
  HealthBadge,
  KeyValue,
  Meter,
  PageHeader,
  SectionHeading,
  StatusPill,
  PriorityPill,
  UnconfirmedBadge,
  type DateRangeValue,
} from "@/components/dashboard/primitives";
import { QueryBoundary } from "@/components/dashboard/query-state";
import {
  useProjects,
  useProjectDetail,
  usePeople,
  toHealth,
  toPriorityLabel,
  type ProjectRow,
  type PersonRow,
} from "@/data/queries";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/supabase";

const searchSchema = z.object({
  project: fallback(z.string(), "").default(""),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
});

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
      {
        property: "og:description",
        content: "Why each project exists, what is happening now and what has shipped.",
      },
    ],
  }),
  component: ProjectsPage,
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// v_person_allocations is keyed for "this person's projects" (see queries.ts),
// so it has no person name column -- fetch it by project_id here and cross
// reference names/roles/bandwidth from usePeople() (already loaded once for
// the whole page) rather than adding a second, project-shaped view.
function useProjectAllocations(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-allocations", projectId ?? ""],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_person_allocations")
        .select("*")
        .eq("project_id", projectId);
      if (error) throw new Error(error.message);
      return data as {
        person_id: string;
        project_id: string;
        project_name: string;
        project_color: string | null;
        pct: number;
        hours: number;
      }[];
    },
  });
}

const activityIcon: Record<string, typeof Activity> = {
  released: Rocket,
  completed: CheckCircle2,
  blocked: CircleSlash,
  qa: TestTube2,
  merged: GitMerge,
  update: Activity,
};

function ProjectsPage() {
  const { project, from, to } = Route.useSearch();
  const navigate = useNavigate({ from: "/projects" });
  const range: DateRangeValue = from || to ? { from, to } : null;
  const { from: sinceIso, to: untilIso } = dateRangeToIso(range);
  const [query, setQuery] = useState("");
  const projectsQuery = useProjects();
  const peopleQuery = usePeople();

  const allProjects = projectsQuery.data ?? [];
  // Only 38 of ~130 synced projects are is_current; that's the set the mock
  // treated as "active" and worth listing here.
  const currentProjects = allProjects.filter((p) => p.is_current);
  // A deep-linked ?project=slug that isn't in the "current" set (e.g. an
  // older project someone still has bookmarked) is pinned to the front so
  // the URL never resolves to an empty workspace.
  const pinned =
    project && !currentProjects.some((p) => p.slug === project)
      ? allProjects.find((p) => p.slug === project)
      : undefined;
  const fullList = pinned ? [pinned, ...currentProjects] : currentProjects;
  // Search narrows which projects show below; the currently open one stays
  // visible regardless so switching the query never yanks away what you're
  // already reading.
  const list = fullList.filter(
    (p) => p.slug === project || p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const openSlug = project || fullList[0]?.slug || "";

  const peopleById = new Map<string, PersonRow>((peopleQuery.data ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        question="What is each project for, what are we building now, and what have we delivered?"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DateRangeFilter
            value={range}
            onChange={(v) =>
              navigate({ search: { project, from: v?.from ?? "", to: v?.to ?? "" } })
            }
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${fullList.length} projects…`}
            className="h-9 w-56 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </PageHeader>

      <QueryBoundary
        isLoading={projectsQuery.isLoading}
        isError={projectsQuery.isError}
        error={projectsQuery.error as Error | null}
      >
        <div className="space-y-6">
          {list.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              open={p.slug === openSlug}
              onToggle={() =>
                navigate({ search: { project: p.slug === openSlug ? "" : p.slug, from, to } })
              }
              peopleById={peopleById}
              since={sinceIso}
              until={untilIso}
            />
          ))}
          {list.length === 0 && (
            <p className="card-soft p-8 text-center text-sm text-muted-foreground">
              {query ? `No projects match "${query}".` : "No active projects to show."}
            </p>
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}

function ProjectCard({
  project,
  open,
  onToggle,
  peopleById,
  since,
  until,
}: {
  project: ProjectRow;
  open: boolean;
  onToggle: () => void;
  peopleById: Map<string, PersonRow>;
  since: string | null;
  until: string | null;
}) {
  // Full detail (initiatives, delivered, risks, activity) and the
  // contributor roster are only fetched once a card is actually expanded --
  // mirrors the lazy-load pattern used for person profiles on /people.
  const detail = useProjectDetail(open ? project.slug : undefined);
  const allocations = useProjectAllocations(open ? project.id : undefined);

  const contributors = (allocations.data ?? [])
    .map((a) => ({ ...a, person: peopleById.get(a.person_id) }))
    .filter((c): c is typeof c & { person: PersonRow } => !!c.person);
  const overallocated = contributors.filter((c) => c.person.utilisation_pct > 100);
  // Items with no completion date can't be placed in the range, so they
  // stay visible rather than being silently dropped by a filter that
  // can't actually evaluate them.
  const delivered = (detail.data?.delivered ?? []).filter(
    (d) => (!since && !until) || !d.date || ((!since || d.date >= since) && (!until || d.date <= until)),
  );

  return (
    <article className="card-soft overflow-hidden">
      {/* header */}
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: project.color || "var(--chart-1)" }}
              />
              <h2 className="text-xl font-semibold">{project.name}</h2>
              <HealthBadge health={toHealth(project.health)} />
              {project.source === "epic_cluster" && (
                <UnconfirmedBadge label="project grouping (auto-clustered from epics)" />
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.sprint_goal ?? "No sprint goal set"} · Owner{" "}
              {project.owner_name ?? "Unassigned"} · {project.contributor_count} contributors ·{" "}
              <span className="num">{project.hours_invested}h</span> invested
            </p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="num">{project.progress ?? 0}%</span>
            </div>
            <Meter
              value={project.progress ?? 0}
              tone={project.health === "at_risk" ? "danger" : "success"}
            />
            {contributors.length > 0 && (
              <div className="mt-3 flex items-center justify-end">
                <AvatarStack
                  people={contributors.map((c) => ({
                    name: c.person.name,
                    initials: initials(c.person.name),
                  }))}
                />
              </div>
            )}
          </div>
        </div>

        {/* purpose + summary */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Purpose
            </p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              {project.purpose ?? "No purpose recorded."}
            </p>
          </div>
          <div className="rounded-xl border border-info/20 bg-info-soft/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-info">Project summary</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              {project.summary_text ?? "No summary yet."}
            </p>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Collapse project" : "Expand project"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="space-y-10 border-t border-border bg-secondary/20 p-6">
          <QueryBoundary
            isLoading={detail.isLoading}
            isError={detail.isError}
            error={detail.error as Error | null}
            loadingLabel="Loading project detail…"
          >
            {detail.data && (
              <>
                {/* Current sprint */}
                <section>
                  <SectionHeading
                    title="What are we working on?"
                    description={
                      detail.data.sprintGoal
                        ? `Sprint goal — ${detail.data.sprintGoal}`
                        : "No sprint goal set"
                    }
                  />
                  <div className="space-y-3">
                    {detail.data.initiatives.map((i) => (
                      <Initiative key={i.name} initiative={i} />
                    ))}
                    {detail.data.initiatives.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No initiatives tracked this sprint.
                      </p>
                    )}
                  </div>
                </section>

                {/* Delivered */}
                <section>
                  <SectionHeading
                    title="What have we delivered?"
                    description="Product capabilities shipped since the project began."
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    {delivered.map((d) => (
                      <div key={d.name} className="card-soft card-hover p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="font-semibold">{d.name}</h4>
                          <Chip tone="success">Shipped</Chip>
                        </div>
                        {d.description ? (
                          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                            {d.description.split("\n").map((line) => (
                              <li key={line}>{line.replace(/^•\s*/, "")}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-sm text-muted-foreground">No description.</p>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <KeyValue
                            label="Completed"
                            value={d.date ? new Date(d.date).toLocaleDateString() : "—"}
                          />
                          <KeyValue label="Hours" value={`${d.hours}h`} />
                        </div>
                      </div>
                    ))}
                    {delivered.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        {since ? "Nothing delivered in this date range." : "Nothing marked as delivered yet."}
                      </p>
                    )}
                  </div>
                </section>

                {/* Contributors */}
                <section>
                  <SectionHeading
                    title="Contributors"
                    description="Who is on this project and how much of them we have."
                  />
                  {allocations.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading contributors…</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {contributors.map((c) => (
                        <div key={c.person_id} className="card-soft card-hover p-4">
                          <div className="flex items-center gap-3">
                            <Avatar
                              person={{ name: c.person.name, initials: initials(c.person.name) }}
                              size="lg"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{c.person.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {c.person.role ?? "Engineer"}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <KeyValue label="Allocation" value={`${c.pct}%`} />
                            <KeyValue label="Hours" value={`${c.hours}h`} />
                            <KeyValue
                              label="Bandwidth"
                              value={`${c.person.bandwidth_hours}h`}
                              tone={c.person.bandwidth_hours < 0 ? "danger" : "success"}
                            />
                          </div>
                          <Link
                            to="/people"
                            search={{ q: "", person: c.person_id }}
                            className="mt-3 inline-block text-sm font-medium text-info hover:underline"
                          >
                            View profile
                          </Link>
                        </div>
                      ))}
                      {contributors.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No contributors recorded for this project.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {/* Metrics */}
                <section>
                  <SectionHeading
                    title="Metrics"
                    description="Delivery throughput and remaining work."
                  />
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                    <KeyValue label="Total hours" value={`${project.hours_invested}h`} />
                    <KeyValue label="Hours this sprint" value={`${project.hours_this_sprint}h`} />
                    <KeyValue label="Completed tickets" value={project.closed_tickets} />
                    <KeyValue label="Open tickets" value={project.open_tickets} />
                    <KeyValue
                      label="Blocked"
                      value={project.blocked_tickets}
                      tone={project.blocked_tickets ? "danger" : "success"}
                    />
                    <KeyValue
                      label="Remaining estimate"
                      value={`${project.remaining_estimate_hours}h`}
                    />
                  </div>
                </section>

                {/* Risks */}
                <section>
                  <SectionHeading
                    title="Risks"
                    description="What needs a decision or an escalation."
                  />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="card-soft p-4">
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Current blockers
                      </p>
                      {detail.data.risks.blockers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No open blockers.</p>
                      ) : (
                        <ul className="space-y-2">
                          {detail.data.risks.blockers.map((b) => (
                            <li
                              key={b.ticket}
                              className="rounded-lg border border-danger/20 bg-danger-soft/50 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="num text-xs font-semibold">{b.ticket}</span>
                                <PriorityPill priority={toPriorityLabel(b.priority)} />
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {daysSince(b.since)} days blocked
                                </span>
                              </div>
                              <p className="mt-1 text-sm">{b.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {b.owner ?? "Unassigned"} · since{" "}
                                {new Date(b.since).toLocaleDateString()}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {/* Dependency links and "stale ticket" counts existed only in
                        the mock data with no backing table/column, so they're
                        dropped here rather than fabricated. */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <KeyValue
                          label="Overallocated"
                          value={overallocated.length}
                          tone={overallocated.length > 0 ? "danger" : "success"}
                        />
                        <KeyValue
                          label="Missing estimates"
                          value={detail.data.risks.missingEstimates}
                          tone="warning"
                        />
                      </div>
                      {overallocated.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft/60 p-3 text-sm">
                          <AlertTriangle className="size-4 text-warning" />
                          {overallocated
                            .map((c) => `${c.person.name} (${c.person.utilisation_pct}%)`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Activity (the mock's separate release "Timeline" mirrored
                    the Delivered section above with no distinct data of its
                    own, so it's folded away -- Activity now runs full width). */}
                <section>
                  <SectionHeading title="Activity" description="Newest first." />
                  <ul className="card-soft divide-y divide-border">
                    {detail.data.activity.map((a, i) => {
                      const Icon = activityIcon[a.kind] ?? Activity;
                      const tone =
                        a.kind === "blocked"
                          ? "text-danger"
                          : a.kind === "released" || a.kind === "completed"
                            ? "text-success"
                            : "text-info";
                      return (
                        <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                          <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                          <div>
                            <p className="text-sm">{a.text}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(a.when).toLocaleString()}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                    {detail.data.activity.length === 0 && (
                      <li className="px-5 py-6 text-sm text-muted-foreground">
                        No recent activity synced yet.
                      </li>
                    )}
                  </ul>
                </section>
              </>
            )}
          </QueryBoundary>
        </div>
      )}
    </article>
  );
}

type DetailInitiative = NonNullable<
  ReturnType<typeof useProjectDetail>["data"]
>["initiatives"][number];

function Initiative({ initiative }: { initiative: DetailInitiative }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-soft overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left hover:bg-secondary/40"
      >
        <div className="min-w-[14rem] flex-1">
          <p className="font-medium">{initiative.name}</p>
          <p className="text-sm text-muted-foreground">{initiative.summary ?? "No summary."}</p>
        </div>
        <div className="w-40">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="num">{initiative.progress}%</span>
          </div>
          <Meter
            value={initiative.progress}
            tone={initiative.progress < 35 ? "warning" : "success"}
          />
        </div>
        <Chip>{initiative.issues.length} issues</Chip>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border bg-secondary/20">
          {initiative.issues.map((issue) => (
            <li key={issue.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="num text-xs font-semibold text-muted-foreground">{issue.key}</span>
              <span className="min-w-[12rem] flex-1 text-sm">{issue.title}</span>
              <StatusPill status={issue.status} />
              <span className="text-xs text-muted-foreground">
                {issue.assignee ?? "Unassigned"}
              </span>
              <span className="num text-xs text-muted-foreground">
                {issue.estimate !== null ? `${issue.estimate}h est` : "No estimate"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
