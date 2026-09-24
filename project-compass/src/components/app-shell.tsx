import { Link } from "@tanstack/react-router";
import {
  Compass,
  ExternalLink,
  Inbox,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { RecentActivity } from "@/components/recent-activity";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/data/queries";
import { clearIdentity, getIdentity } from "@/lib/stakeholder-types";
import { cn } from "@/lib/utils";

// Persists the sidebar collapsed/expanded state across reloads. Wrapped in
// try/catch-and-ignore per the established localStorage pattern in
// src/lib/stakeholder-types.ts (see getIdentity/setIdentity).
const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setStoredSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore -- private browsing / storage blocked; state just won't persist
  }
}

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  // Read from localStorage after mount so server-rendered/first-paint markup
  // stays consistent, then sync any change back to storage.
  useEffect(() => {
    setCollapsed(getStoredSidebarCollapsed());
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      setStoredSidebarCollapsed(next);
      return next;
    });
  };

  return { collapsed, toggle };
}

function NavItem({
  to,
  icon: Icon,
  label,
  exact,
  collapsed,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  exact?: boolean;
  collapsed?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      activeProps={{
        className:
          "bg-sidebar-accent !text-sidebar-accent-foreground font-medium border-sidebar-primary",
      }}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
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
function IdentityDisplay({ collapsed }: { collapsed?: boolean }) {
  const identity = getIdentity();
  if (!identity) return null;
  const initials = identity.name
    .split(" ")
    .map((p) => p[0])
    .join("");

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          title={`${identity.name} (${identity.email})`}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground"
        >
          {initials}
        </div>
        <Button
          variant="ghost"
          size="sm"
          title="Switch identity"
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
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "hidden shrink-0 flex-col bg-sidebar transition-[width] duration-200 ease-in-out lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4",
            collapsed && "justify-center px-2",
          )}
        >
          <div
            title={collapsed ? "Stakeholder Management Console" : undefined}
            className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground"
          >
            <Compass className="size-4" />
          </div>
          {collapsed ? null : (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold text-sidebar-foreground">
                Stakeholder
              </p>
              <p className="text-[11px] text-sidebar-foreground/60">Management Console</p>
            </div>
          )}
        </div>
        <nav className={cn("flex-1 space-y-1 py-4", collapsed ? "px-2" : "px-3")}>
          <NavItem to="/" icon={LayoutGrid} label="Projects" exact collapsed={collapsed} />
          <NavItem
            to="/client-requests"
            icon={Inbox}
            label="Client Requests"
            collapsed={collapsed}
          />
          {collapsed ? (
            <div className="pt-5 pb-2">
              <div className="mx-auto h-px w-6 bg-sidebar-border/80" />
            </div>
          ) : (
            <p className="px-3 pt-5 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/45 uppercase">
              Modules
            </p>
          )}
          {(projects ?? []).map((p) =>
            collapsed ? (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                title={p.name}
                className="flex items-center justify-center rounded-md border-l-2 border-transparent px-0 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "bg-sidebar-accent !text-sidebar-accent-foreground font-medium border-sidebar-primary",
                }}
              >
                <span className="w-8 shrink-0 rounded bg-sidebar-border/80 px-1 py-0.5 text-center font-mono text-[10px] tracking-wide">
                  {p.code}
                </span>
              </Link>
            ) : (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className="flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "bg-sidebar-accent !text-sidebar-accent-foreground font-medium border-sidebar-primary",
                }}
              >
                <span className="w-8 shrink-0 rounded bg-sidebar-border/80 px-1 py-0.5 text-center font-mono text-[10px] tracking-wide">
                  {p.code}
                </span>
                <span className="truncate">{p.name}</span>
              </Link>
            ),
          )}
        </nav>
        <div className={cn("border-t border-sidebar-border py-3.5", collapsed ? "px-2" : "px-4")}>
          <IdentityDisplay collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden shrink-0 rounded-md border border-border bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:grid lg:place-items-center"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
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
