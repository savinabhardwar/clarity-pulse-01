import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ListChecks, Wrench } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useItems, useProjects } from "@/data/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stakeholder Management — Projects & Modules" },
      {
        name: "description",
        content:
          "Select a project module to manage stakeholder features, client request items, statuses, priorities and audit history.",
      },
      { property: "og:title", content: "Stakeholder Management — Projects & Modules" },
      {
        property: "og:description",
        content:
          "Enterprise console for tracking stakeholder features and client request work across project modules.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectCard({ projectId }: { projectId: string }) {
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === projectId);
  const { data: features } = useItems(projectId, "feature");
  const { data: implementation } = useItems(projectId, "implementation");
  if (!project) return null;

  const high =
    (features?.filter((i) => i.priority === "High").length ?? 0) +
    (implementation?.filter((i) => i.priority === "High").length ?? 0);

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-raised transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-panel active:translate-y-0 active:shadow-raised"
    >
      <span className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-brand transition-transform duration-200 group-hover:scale-x-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-block rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-brand">
            {project.code}
          </span>
          <h2 className="mt-2 truncate text-lg font-semibold text-foreground">{project.name}</h2>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand" />
      </div>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-muted-foreground">
        {project.description}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-3.5" /> {features?.length ?? 0} features
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wrench className="size-3.5" /> {implementation?.length ?? 0} client requests
        </span>
        {high > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-high-soft px-2 py-0.5 font-medium text-high">
            {high} high priority
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Owner <span className="text-foreground/70">· {project.owner}</span>
      </p>
    </Link>
  );
}

function ProjectsPage() {
  const { data: projects, isLoading, isError } = useProjects();

  return (
    <AppShell
      title="Stakeholder Management"
      subtitle="Select a project module to manage its stakeholder items"
    >
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border bg-card shadow-raised"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-destructive">
          Couldn't load projects. Please refresh.
        </div>
      ) : !projects || projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-muted-foreground">
          No projects configured yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} projectId={p.id} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
