import { Link } from "@tanstack/react-router";
import {
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
        "flex h-9 items-center gap-3 rounded-[6px] px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:text-muted-foreground",
        collapsed && "justify-center px-0",
      )}
      activeProps={{
        className:
          "bg-sidebar-accent !text-sidebar-accent-foreground font-semibold [&_svg]:!text-sidebar-accent-foreground",
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
          className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-[#D9DEE5] bg-white px-3.5 text-[13px] font-medium text-[#202938] transition-colors hover:bg-muted"
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
  icon: Icon,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
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
          collapsed ? "w-16" : "w-[232px]",
        )}
      >
        <div
          className={cn(
            "flex h-[54px] shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3",
            collapsed && "justify-center px-2",
          )}
        >
          <div
            title={collapsed ? "Stakeholder Management Console" : undefined}
            className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground"
          >
            S
          </div>
          {collapsed ? null : (
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold text-foreground">Stakeholder</p>
              <p className="text-[11px] text-muted-foreground">Management Console</p>
            </div>
          )}
        </div>
        <nav className={cn("flex-1 space-y-1 py-3", collapsed ? "px-2" : "px-3")}>
          <NavItem to="/" icon={LayoutGrid} label="Projects" exact collapsed={collapsed} />
          <NavItem
            to="/client-requests"
            icon={Inbox}
            label="Client Requests"
            collapsed={collapsed}
          />
          {collapsed ? (
            <div className="pt-4.5 pb-2">
              <div className="mx-auto h-px w-6 bg-sidebar-border" />
            </div>
          ) : (
            <p className="px-3 pt-4.5 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
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
                className="flex h-9 items-center justify-center rounded-[6px] px-0 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: "bg-sidebar-accent !text-sidebar-accent-foreground font-semibold",
                }}
              >
                <span className="flex h-[18px] min-w-[30px] shrink-0 items-center justify-center rounded bg-surface-strong px-1 text-center font-mono text-[9px] font-semibold tracking-wide text-muted-foreground">
                  {p.code}
                </span>
              </Link>
            ) : (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className="flex h-9 items-center gap-3 rounded-[6px] px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: "bg-sidebar-accent !text-sidebar-accent-foreground font-semibold",
                }}
              >
                <span className="flex h-[18px] min-w-[30px] shrink-0 items-center justify-center rounded bg-surface-strong px-1 text-center font-mono text-[9px] font-semibold tracking-wide text-muted-foreground">
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
        <header className="sticky top-0 z-20 min-h-[74px] border-b border-border bg-card">
          <div className="flex min-h-[74px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-[30px]">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden size-8 shrink-0 rounded-[7px] border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:grid lg:place-items-center"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
              {Icon && (
                <div className="hidden size-8 shrink-0 items-center justify-center rounded-[7px] border border-[#DFE3E8] text-[#667085] sm:flex">
                  <Icon className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-[25px] leading-[30px] font-semibold text-[#161E2B]">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-[3px] truncate text-[13px] leading-[18px] text-[#667085]">
                    {subtitle}
                  </p>
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
        <main className={cn("flex-1 px-5 py-6 lg:px-[30px]")}>{children}</main>
      </div>
    </div>
  );
}
