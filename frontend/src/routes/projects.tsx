import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "@/components/emp/shell";
import { Bar, Metric, Panel, SectionHeader, StatusPill } from "@/components/emp/bits";
import { Input } from "@/components/ui/input";
import { useEm, filteredProjects } from "@/lib/emp-store";
import { contributorsForProject, projectSpaceToTeam, round, toHealth } from "@/lib/emp-engine";
import { useProjectDetail, type ProjectRow } from "@/data/queries";

const title = "Projects — Engineering Investment & Delivery";
const description =
  "Every project with status, engineering investment, delivered features, current sprint goal and active risks.";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: ProjectsPage,
});

function timeActive(startedAt: string): string {
  const months = Math.max(
    0,
    Math.round((Date.now() - new Date(startedAt).getTime()) / (30.44 * 24 * 3600 * 1000)),
  );
  if (months < 1) return "< 1 month";
  return months === 1 ? "1 month" : `${months} months`;
}

function ProjectsPage() {
  const { filters, projects, allocations, people } = useEm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const list = useMemo(() => {
    return filteredProjects(filters, projects, allocations)
      .filter((p) => p.is_current && (p.open_tickets > 0 || p.closed_tickets > 0))
      .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.remaining_estimate_hours - a.remaining_estimate_hours);
  }, [q, filters, projects, allocations]);

  return (
    <AppShell
      title="Projects"
      description="Which projects need my attention, and what are we investing in?"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search projects"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-60"
        />
        <span className="ml-auto text-xs text-muted-foreground">{list.length} projects</span>
      </div>

      <div className="mt-5 space-y-3">
        {list.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            contributors={contributorsForProject(p.id, allocations, people)}
            open={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
          />
        ))}
        {list.length === 0 && (
          <Panel>
            <p className="text-sm text-muted-foreground">No projects match the current filters.</p>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

function ProjectCard({
  p,
  contributors,
  open,
  onToggle,
}: {
  p: ProjectRow;
  contributors: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const detail = useProjectDetail(p.slug, open);

  return (
    <article className="panel overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 p-4 text-left hover:bg-secondary/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{p.name}</p>
            <StatusPill status={toHealth(p.health)} />
            <span className="text-xs text-muted-foreground">
              {projectSpaceToTeam(p.project_space)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Started {new Date(p.started_at).toLocaleDateString()} · Active{" "}
            {timeActive(p.started_at)}
          </p>
        </div>
        <div className="hidden gap-8 lg:flex">
          <Metric label="Investment" value={`${p.hours_invested.toLocaleString()}h`} />
          <Metric label="Logged this sprint" value={`${p.hours_this_sprint}h`} />
          <div className="w-40">
            <p className="stat-label">Progress</p>
            {p.progress !== null ? (
              <div className="mt-2 flex items-center gap-2">
                <Bar value={p.progress} />
                <span className="text-sm tabular-nums">{p.progress}%</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not tracked</p>
            )}
          </div>
        </div>
        <ChevronDown
          className={"size-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>

      {open && (
        <div className="space-y-6 border-t border-border bg-surface p-5">
          <div>
            <p className="stat-label">Purpose</p>
            <p className="mt-1 text-sm">{p.purpose ?? "No purpose recorded."}</p>
          </div>

          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading project detail…</p>
          ) : (
            <>
              <div className="rounded-md border border-border bg-card p-4">
                <SectionHeader title="Project summary" />
                <p className="text-sm leading-relaxed">
                  {detail.data?.summary ?? "No summary recorded."}
                </p>
              </div>

              <div>
                <SectionHeader title="Engineering investment" />
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  <Metric label="Investment" value={`${p.hours_invested.toLocaleString()}h`} />
                  <Metric label="Planned this sprint" value={`${p.remaining_estimate_hours}h`} />
                  <Metric label="Logged this sprint" value={`${p.hours_this_sprint}h`} />
                  <Metric
                    label="Projected spillage"
                    value={
                      <span className={p.spillage_hours > 0 ? "text-destructive" : "text-success"}>
                        {round(p.spillage_hours)}h
                      </span>
                    }
                  />
                  <Metric label="Contributors this sprint" value={contributors.length} />
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <SectionHeader title="Delivery" hint="Recently shipped features" />
                  <div className="space-y-3">
                    {(detail.data?.delivered ?? []).map((d) => (
                      <div key={d.name}>
                        <p className="text-xs font-semibold text-muted-foreground">
                          {d.date ? new Date(d.date).toLocaleDateString() : "—"} · {d.hours}h
                        </p>
                        <p className="mt-1 text-sm">{d.name}</p>
                      </div>
                    ))}
                    {(detail.data?.delivered.length ?? 0) === 0 && (
                      <p className="text-sm text-muted-foreground">Nothing delivered recently.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <SectionHeader title="Current sprint" />
                    <p className="text-sm">
                      {detail.data?.sprintGoal ?? "No sprint goal recorded."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Working on it this sprint:{" "}
                      {contributors.length > 0
                        ? contributors.join(", ")
                        : "No one assigned this sprint."}
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {(detail.data?.currentSprintTickets ?? []).map((t) => (
                        <li key={t.key} className="flex items-start gap-2 text-sm">
                          <span className="shrink-0 text-xs text-muted-foreground">{t.key}</span>
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{t.status}</span>
                        </li>
                      ))}
                      {(detail.data?.currentSprintTickets.length ?? 0) === 0 && (
                        <li className="text-sm text-muted-foreground">
                          No tickets in this project's sprint.
                        </li>
                      )}
                    </ul>
                  </div>

                  <div>
                    <SectionHeader title="Active risks" />
                    {(detail.data?.risks.blockers.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No active blockers.</p>
                    ) : (
                      <ul className="space-y-2">
                        {detail.data!.risks.blockers.map((r) => (
                          <li
                            key={r.ticket}
                            className="rounded-md border border-border bg-card p-3"
                          >
                            <p className="text-xs text-muted-foreground">
                              {r.ticket} · {r.owner ?? "Unassigned"}
                            </p>
                            <p className="mt-1 text-sm">{r.title}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
