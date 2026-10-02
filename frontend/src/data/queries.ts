import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { Health, Ticket } from "./dashboard";

// The DB's health enum, as returned raw by Postgres before toHealth()
// maps it to the UI's title-case Health type.
export type DbHealth = "on_track" | "needs_attention" | "at_risk";

// ---------- Query key namespace ----------
export const queryKeys = {
  people: ["people"] as const,
  person: (id: string) => ["people", id] as const,
  projects: ["projects"] as const,
  project: (slug: string) => ["projects", slug] as const,
  orgMetrics: ["org-metrics"] as const,
  standouts: ["standouts"] as const,
  allBlockers: ["all-blockers"] as const,
  ticketHygiene: ["ticket-hygiene"] as const,
  teams: ["teams"] as const,
};

// DB health enum is snake_case; the UI's Health type (and every
// component keying off it, e.g. HealthBadge) expects the original
// title-case strings. Map at render time so no UI component needs to
// change, while call sites that need to branch on the raw DB value
// (filters, sorts) keep using DbHealth directly.
const HEALTH_MAP: Record<DbHealth, Health> = {
  on_track: "On Track",
  needs_attention: "Needs Attention",
  at_risk: "At Risk",
};
export function toHealth(dbValue: DbHealth): Health {
  return HEALTH_MAP[dbValue] ?? "On Track";
}

// DB status_mapping.ui_bucket already matches the UI's Ticket["status"]
// strings verbatim (see supabase/migrations/0002_core_tables.sql), so no
// mapping is needed there. Priority is stored lowercase in the DB
// ('highest' | 'high' | 'medium' | 'low' | 'lowest'); the UI's
// PriorityPill only special-cases "Critical"/"High", everything else
// renders as a neutral chip, so title-casing is enough.
export function toPriorityLabel(dbValue: string | null): string {
  if (!dbValue) return "Medium";
  return dbValue.charAt(0).toUpperCase() + dbValue.slice(1);
}

// ---------- Dashboard queries: Python owns the database boundary ----------
export function usePeople(asOf?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.people, asOf ?? "latest"],
    queryFn: () =>
      apiRequest<PersonRow[]>(`/people${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`),
  });
}

export function usePersonDetail(personId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.person(personId ?? ""),
    enabled: !!personId,
    queryFn: () => apiRequest<PersonDetail | null>(`/people/${encodeURIComponent(personId ?? "")}`),
  });
}

export function useProjectDetail(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.project(slug ?? ""),
    enabled: !!slug,
    queryFn: () => apiRequest<ProjectDetail | null>(`/projects/${encodeURIComponent(slug ?? "")}`),
  });
}

export interface AllocationRow {
  person_id: string;
  project_id: string;
  project_name: string;
  project_color: string | null;
  pct: number;
  hours: number;
}

export function usePersonAllocations(personId: string | undefined) {
  return useQuery({
    queryKey: ["allocations", personId ?? ""],
    enabled: !!personId,
    queryFn: () =>
      apiRequest<AllocationRow[]>(`/allocations?personId=${encodeURIComponent(personId ?? "")}`),
  });
}

export function useProjectAllocations(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-allocations", projectId ?? ""],
    enabled: !!projectId,
    queryFn: () =>
      apiRequest<AllocationRow[]>(`/allocations?projectId=${encodeURIComponent(projectId ?? "")}`),
  });
}

export function useRecentActivity(since?: string | null) {
  return useQuery({
    queryKey: ["recent-activity", since ?? "all"],
    queryFn: () =>
      apiRequest<ActivityRow[]>(
        `/recent-activity${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      ),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => apiRequest<ProjectRow[]>("/projects"),
  });
}

export function useAllPersonAllocations() {
  return useQuery({
    queryKey: ["all-person-allocations"],
    queryFn: () => apiRequest<AllocationRow[]>("/allocations"),
  });
}

export function useOrgMetrics() {
  return useQuery({
    queryKey: queryKeys.orgMetrics,
    queryFn: () => apiRequest<OrgMetrics>("/org-metrics"),
  });
}

export function useStandouts() {
  return useQuery({
    queryKey: queryKeys.standouts,
    queryFn: () =>
      apiRequest<
        { title: string; person_id: string; person_name: string; detail: string | null }[]
      >("/standouts"),
  });
}

export function useAllBlockers() {
  return useQuery({
    queryKey: queryKeys.allBlockers,
    queryFn: () => apiRequest<BlockerRow[]>("/blockers"),
  });
}

export function useTicketHygiene() {
  return useQuery({
    queryKey: queryKeys.ticketHygiene,
    queryFn: () => apiRequest<TicketHygieneRow[]>("/ticket-hygiene"),
  });
}

export function useTopRisks() {
  return useQuery({
    queryKey: ["top-risks"],
    queryFn: () => apiRequest<RiskRow[]>("/top-risks"),
  });
}

export function useSprintOverrunCount() {
  return useQuery({
    queryKey: ["sprint-overrun-count"],
    queryFn: () => apiRequest<number>("/sprint-overrun-count"),
  });
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiRequest<{ id: string; name: string }[]>("/teams"),
  });
}

export function useProjectContributors() {
  return useQuery({
    queryKey: ["project-contributors"],
    queryFn: () => apiRequest<ProjectContributorRow[]>("/project-contributors"),
  });
}

export function useTrackedSprintStatus() {
  return useQuery({
    queryKey: ["tracked-sprint-status"],
    queryFn: () => apiRequest<{ total: number; overrunning: number }>("/tracked-sprint-status"),
  });
}

// ---------- Shapes returned by the RPC / views (frontend-facing) ----------
export interface PersonRow {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  team_guessed: boolean;
  utilisation_pct: number;
  bandwidth_hours: number;
  pace_pct: number;
  pace_target_hours: number;
  hours_logged: number;
  estimated_hours: number;
  velocity: number;
  estimate_accuracy: number | null;
  estimate_coverage: number;
  worklog_count: number;
  comment_count: number;
  idle_workdays: number;
  dark_wip_count: number;
  health: DbHealth;
  risk_flags: string[];
  target_hours_is_fallback: boolean;
  overallocation_reason: string | null;
}

export const PROJECT_SPACES = ["development", "infra", "telephony"] as const;
export type ProjectSpace = (typeof PROJECT_SPACES)[number];

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  purpose: string | null;
  health: DbHealth;
  progress: number | null;
  sprint_goal: string | null;
  owner_name: string | null;
  is_current: boolean;
  source: "epic_cluster" | "roadmap" | "manual";
  // Which Projects-page tab this project belongs to, derived in
  // v_projects_overview from the Jira boards its epics come from (see
  // migration 0020): 'infra' = all TI, 'telephony' = all TT, everything
  // else (multi-board, TEAM/TEAMSANKYA/TRG, or no Jira link at all) is
  // 'development'. Exactly one bucket per project.
  project_space: ProjectSpace;
  summary_text: string | null;
  hours_invested: number;
  hours_this_sprint: number;
  open_tickets: number;
  closed_tickets: number;
  blocked_tickets: number;
  remaining_estimate_hours: number;
  contributor_count: number;
  spillage_hours: number;
}

export interface ProjectContributorRow {
  person_id: string;
  project_id: string;
  pct: number;
  hours: number;
}

export interface OrgMetrics {
  avg_utilisation: number;
  available_hours: number;
  overallocated_count: number;
  at_risk_projects: number;
  active_projects: number;
  estimate_coverage: number;
  blocked_count: number;
  dark_wip: number;
  closed_without_logs: number;
  board_health_score: number;
  total_spillage_hours: number;
}

export interface ActivityRow {
  occurred_at: string;
  text: string;
  kind: "released" | "completed" | "blocked" | "qa" | "merged" | "update";
  project_id: string;
  project_name: string;
}

export interface RiskRow {
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  recommendation: string | null;
  person_id: string | null;
  project_id: string | null;
  identified_at: string;
}

export interface BlockerRow {
  ticket_id: string;
  jira_key: string;
  summary: string;
  priority: string | null;
  updated_at: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  owner_name: string | null;
  days_blocked: number;
}

export interface TicketHygieneRow {
  ticket_id: string;
  jira_key: string;
  summary: string;
  status: string;
  status_category: string;
  updated_at: string;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
  person_id: string | null;
  person_name: string | null;
  sprint_name: string;
  missing_estimate: boolean;
  missing_epic: boolean;
  missing_comments: boolean;
  missing_worklog: boolean;
}

export interface PersonDetail {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  teamGuessed: boolean;
  metrics: Record<string, unknown>;
  allocations: {
    projectId: string;
    projectName: string;
    color: string | null;
    pct: number;
    hours: number;
  }[];
  current: Ticket[];
  upcoming: Ticket[];
  completed: Ticket[];
  comments: { ticket: string; text: string; when: string }[];
}

export interface ProjectDetail {
  id: string;
  name: string;
  color: string | null;
  purpose: string | null;
  health: DbHealth;
  progress: number | null;
  sprintGoal: string | null;
  summary: string | null;
  initiatives: {
    name: string;
    summary: string | null;
    progress: number;
    issues: {
      key: string;
      title: string;
      status: string;
      assignee: string | null;
      estimate: number | null;
    }[];
  }[];
  delivered: {
    name: string;
    description: string | null;
    date: string | null;
    hours: number;
    tickets: string[];
  }[];
  risks: {
    blockers: {
      ticket: string;
      title: string;
      since: string;
      owner: string | null;
      priority: string | null;
    }[];
    missingEstimates: number;
  };
  activity: { when: string; text: string; kind: string }[];
}
