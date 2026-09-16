import { Link } from "@tanstack/react-router";
import { ExternalLink, Inbox, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RecentActivity } from "@/components/recent-activity";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/data/queries";
import { clearIdentity, getIdentity } from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

function NavItem({
  to,
  icon: Icon,
  label,
  exact,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      activeProps={{ className: "bg-sidebar-accent !text-sidebar-accent-foreground font-medium" }}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// Links to the other two dashboards in this monorepo -- separate deployed
// apps (each their own Cloudflare Worker), not routes of this app, so plain
// external links rather than TanStack <Link>.
const SIBLING_DASHBOARDS = [
  {
    label: "Employee Dashboard",
    href: "https://savinabhardwar-engineering-ethos.bhardwarsavina.workers.dev",
  },
  {
    label: "Management Dashboard",
    href: "https://savinabhardwar-team-pulse-54.bhardwarsavina.workers.dev",
  },
];

function SiblingDashboardLinks() {
  return (
    <>
      {SIBLING_DASHBOARDS.map((d) => (
        <a
          key={d.href}
          href={d.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {d.label}
          <ExternalLink className="size-3.5" />
        </a>
      ))}
    </>
  );
}

// No login exists anywhere in this monorepo -- this is a display of the
// self-declared identity from identity-gate.tsx, used for audit/comment
// attribution. "Switch identity" clears it and reloads, which re-triggers
// the gate (the simplest way to let someone re-declare who they are).
function IdentityDisplay() {
  const identity = getIdentity();
  if (!identity) return null;
  const initials = identity.name
    .split(" ")
    .map((p) => p[0])
    .join("");

  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
        {initials}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-medium text-sidebar-foreground">{identity.name}</p>
        <p className="truncate text-[11px] text-sidebar-foreground/55">{identity.email}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-1.5 py-1 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground"
        onClick={() => {
          clearIdentity();
          window.location.reload();
        }}
      >
        Switch
      </Button>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { data: projects } = useProjects();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
          <div className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            SM
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold text-sidebar-foreground">
              Stakeholder
            </p>
            <p className="text-[11px] text-sidebar-foreground/60">Management Console</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          <NavItem to="/" icon={LayoutGrid} label="Projects" exact />
          <NavItem to="/client-requests" icon={Inbox} label="Client Requests" />
          <p className="px-3 pt-5 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/45 uppercase">
            Modules
          </p>
          {(projects ?? []).map((p) => (
            <Link
              key={p.id}
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className: "bg-sidebar-accent !text-sidebar-accent-foreground font-medium",
              }}
            >
              <span className="w-8 shrink-0 rounded bg-sidebar-border/80 px-1 py-0.5 text-center font-mono text-[10px] tracking-wide">
                {p.code}
              </span>
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3.5">
          <IdentityDisplay />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SiblingDashboardLinks />
              {actions}
              <RecentActivity />
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            <NavItem to="/" icon={Users} label="Projects" exact />
            <NavItem to="/client-requests" icon={Inbox} label="Client Requests" />
          </nav>
        </header>
        <main className={cn("flex-1 px-5 py-6 lg:px-8")}>{children}</main>
      </div>
    </div>
  );
}
