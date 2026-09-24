import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft, FolderOpen } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ItemsTable } from "@/components/stakeholder/items-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useItems } from "@/data/queries";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { ItemKind, Project } from "@/lib/stakeholder-types";

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("stakeholder_projects")
      .select("id,name,code,jira_project_key,owner,description")
      .eq("id", params.projectId)
      .maybeSingle();
    if (error || !data) throw notFound();
    const project: Project = {
      id: data.id,
      name: data.name,
      code: data.code,
      jiraProjectKey: data.jira_project_key,
      owner: data.owner ?? "",
      description: data.description ?? "",
    };
    return { project };
  },
  head: ({ loaderData }) => {
    const name = loaderData?.project.name;
    if (!name) {
      return {
        meta: [{ title: "Module unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `${name} — Stakeholder Items`;
    const description = `Manage ${name} stakeholder features and client request items: statuses, priorities, owners, dates, attachments and audit history.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: ProjectPage,
});

function ProjectPage() {
  const { project } = Route.useLoaderData();
  const [tab, setTab] = useState<ItemKind>("feature");

  const { data: features } = useItems(project.id, "feature");
  const { data: implementation } = useItems(project.id, "implementation");

  return (
    <AppShell
      title={project.name}
      subtitle={project.description}
      icon={FolderOpen}
      actions={
        <Link
          to="/"
          className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-[#D9DEE5] bg-white px-3.5 text-[13px] font-medium text-[#202938] transition-colors hover:bg-muted"
        >
          <ChevronLeft className="size-4" /> All projects
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as ItemKind)} className="gap-5">
        <TabsList className="h-10 gap-1 rounded-lg border border-border bg-surface-strong p-1">
          <TabsTrigger
            value="feature"
            className={cn(
              "px-5 transition-colors data-[state=active]:font-semibold data-[state=active]:shadow-raised",
              tab === "feature" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Features
            <span
              className={cn(
                "ml-2 rounded-full px-1.5 text-[11px] font-medium",
                tab === "feature" ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
              )}
            >
              {features?.length ?? 0}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="implementation"
            className={cn(
              "px-5 transition-colors data-[state=active]:font-semibold data-[state=active]:shadow-raised",
              tab === "implementation" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Client Requests
            <span
              className={cn(
                "ml-2 rounded-full px-1.5 text-[11px] font-medium",
                tab === "implementation"
                  ? "bg-brand-soft text-brand"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {implementation?.length ?? 0}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feature">
          <ItemsTable project={project} kind="feature" />
        </TabsContent>
        <TabsContent value="implementation">
          <ItemsTable project={project} kind="implementation" />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
