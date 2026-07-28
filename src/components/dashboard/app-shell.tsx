import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlobalSearch } from "./global-search";
import { supabase } from "@/supabase";

// There is no single "the sprint" -- 5 teams run 5 differently-dated
// Jira sprints. Rather than fake one global sprint name/day/length (the
// mock UI's model), the header badge surfaces the one cross-team signal
// that IS meaningful at a glance: how many of those 5 sprints are
// currently overrunning their planned end date.
function useTrackedSprintStatus() {
  return useQuery({
    queryKey: ["tracked-sprint-status"],
    queryFn: async () => {
      const [{ count: total }, { count: overrunning }] = await Promise.all([
        supabase.from("sprints").select("*", { count: "exact", head: true }).eq("is_tracked", true),
        supabase
          .from("risks")
          .select("*", { count: "exact", head: true })
          .eq("category", "sprint_overrun")
          .eq("status", "open"),
      ]);
      return { total: total ?? 0, overrunning: overrunning ?? 0 };
    },
  });
}

const nav = [
  { to: "/", label: "Overview" },
  { to: "/resource-planning", label: "Resource Planning" },
  { to: "/projects", label: "Projects" },
  { to: "/people", label: "People" },
  { to: "/team-health", label: "Team Health" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const sprintStatus = useTrackedSprintStatus();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              E
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">
              Engineering Leadership
            </span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {sprintStatus.data && (
              <span className="hidden rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground md:inline-flex">
                {sprintStatus.data.total} tracked sprints
                {sprintStatus.data.overrunning > 0 && (
                  <span className="ml-1 text-warning">
                    · {sprintStatus.data.overrunning} overrunning
                  </span>
                )}
              </span>
            )}
            <GlobalSearch />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 lg:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
    </div>
  );
}
