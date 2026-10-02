import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CalendarRange,
  CalendarClock,
  Gauge,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TEAMS } from "@/lib/emp-data";
import { useEm } from "@/lib/emp-store";
import type { Team } from "@/lib/emp-data";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/people", label: "People", icon: Users },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/planning", label: "Planning", icon: CalendarRange },
  { to: "/next-sprint", label: "Next Sprint", icon: CalendarClock },
  { to: "/trends", label: "Trends", icon: TrendingUp },
] as const;

export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { isLoading, error } = useEm();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-4 py-6 text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Gauge className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Delivery Lens</p>
            <p className="text-[11px] text-sidebar-foreground/60">Engineering Management</p>
          </div>
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto px-3 text-[11px] leading-relaxed text-sidebar-foreground/50">
          Synced hourly from Jira. Numbers reflect the last successful sync.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
          <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4 md:px-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            </div>
            <nav className="flex gap-1 md:hidden">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/" }}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <GlobalFilters />
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-5 py-6 md:px-8">
          {error ? (
            <div className="panel p-8 text-center text-sm text-destructive">
              Failed to load data: {error.message}
            </div>
          ) : isLoading ? (
            <div className="panel p-8 text-center text-sm text-muted-foreground">
              Loading live data…
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function GlobalFilters() {
  const { filters, setFilters, resetFilters, projects, allPeople } = useEm();
  const projectOptions = Array.from(new Set(projects.map((p) => p.name))).sort();

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 md:px-8">
      <span className="stat-label mr-1">Filters</span>
      <Select value={filters.team} onValueChange={(v) => setFilters({ team: v as Team | "All" })}>
        <SelectTrigger className="h-8 w-[150px] text-xs">
          <SelectValue placeholder="Team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All teams</SelectItem>
          {TEAMS.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.project} onValueChange={(v) => setFilters({ project: v })}>
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue placeholder="Project" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All projects</SelectItem>
          {projectOptions.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.employee} onValueChange={(v) => setFilters({ employee: v })}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue placeholder="Employee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All employees</SelectItem>
          {allPeople.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
        Reset
      </Button>
    </div>
  );
}
