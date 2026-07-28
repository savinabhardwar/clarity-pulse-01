import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/supabase";
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
  teams: ["teams"] as const,
};

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("No data returned");
  return res.data;
}

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

// ---------- People ----------
export function usePeople() {
  return useQuery({
    queryKey: queryKeys.people,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("v_people_overview")
          .select("*")
          .order("utilisation_pct", { ascending: false }),
      ),
  });
}

export function usePersonDetail(personId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.person(personId ?? ""),
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_person_detail", { p_person_id: personId });
      if (error) throw new Error(error.message);
      return data as PersonDetail;
    },
  });
}

// ---------- Projects ----------
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("v_projects_overview")
          .select("*")
          .order("hours_invested", { ascending: false }),
      ),
  });
}

export function useProjectDetail(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.project(slug ?? ""),
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_project_detail", { p_slug: slug });
      if (error) throw new Error(error.message);
      return data as ProjectDetail;
    },
  });
}

export function usePersonAllocations(personId: string | undefined) {
  return useQuery({
    queryKey: ["allocations", personId ?? ""],
    enabled: !!personId,
    queryFn: async () =>
      unwrap(await supabase.from("v_person_allocations").select("*").eq("person_id", personId)),
  });
}

// ---------- Org-wide ----------
export function useOrgMetrics() {
  return useQuery({
    queryKey: queryKeys.orgMetrics,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_org_metrics").select("*").single();
      if (error) throw new Error(error.message);
      return data as OrgMetrics;
    },
  });
}

export function useStandouts() {
  return useQuery({
    queryKey: queryKeys.standouts,
    queryFn: async () => unwrap(await supabase.from("v_standouts").select("*")),
  });
}

export function useAllBlockers() {
  return useQuery({
    queryKey: queryKeys.allBlockers,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("v_all_blockers")
          .select("*")
          .order("days_blocked", { ascending: false }),
      ),
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => unwrap(await supabase.from("v_recent_activity").select("*").limit(15)),
  });
}

export function useTopRisks() {
  return useQuery({
    queryKey: ["top-risks"],
    queryFn: async () => unwrap(await supabase.from("v_top_risks").select("*")),
  });
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: async () => unwrap(await supabase.from("teams").select("*").order("name")),
  });
}

// Every project's contributor breakdown (person_id/project_id/pct/hours),
// fetched in bulk rather than per-project -- same "bulk over N+1" choice
// useAllAllocations() makes on the Overview route -- since resource-planning
// renders one card per current project (~38) and each needs its own
// ownership list. v_person_allocations already carries exactly these
// columns (it's project_contributors joined to projects for name/color,
// which callers here don't need), so this just re-shapes that view rather
// than adding new joins.
export function useProjectContributors() {
  return useQuery({
    queryKey: ["project-contributors"],
    queryFn: async () =>
      unwrap<ProjectContributorRow[]>(
        await supabase.from("v_person_allocations").select("person_id, project_id, pct, hours"),
      ),
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
}

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
  summary_text: string | null;
  hours_invested: number;
  hours_this_sprint: number;
  open_tickets: number;
  closed_tickets: number;
  blocked_tickets: number;
  remaining_estimate_hours: number;
  contributor_count: number;
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
