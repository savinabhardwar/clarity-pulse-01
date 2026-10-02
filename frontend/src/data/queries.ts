import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/clarity/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string" ? body.detail : "The request could not be completed",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

// DB's health enum, as returned raw by Postgres.
export type DbHealth = "on_track" | "needs_attention" | "at_risk";

// ---------- Shapes returned by the views / RPCs ----------
export interface PersonRow {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  team_guessed: boolean;
  bandwidth_hours: number;
  utilisation_pct: number;
  pace_pct: number;
  estimated_hours: number;
  hours_logged: number;
  estimate_accuracy: number | null;
  estimate_coverage: number;
  idle_workdays: number;
  dark_wip_count: number;
  health: DbHealth;
  risk_flags: string[];
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  health: DbHealth;
  progress: number | null;
  sprint_goal: string | null;
  is_current: boolean;
  project_space: "development" | "infra" | "telephony";
  started_at: string;
  hours_invested: number;
  /** Hours logged against this project since the sprint started -- NOT planned/allocated work, despite the name. See useProjectsOverview. */
  hours_this_sprint: number;
  /** Outstanding estimated work on this project's open tickets -- what the UI actually means by "planned this sprint." */
  remaining_estimate_hours: number;
  spillage_hours: number;
  open_tickets: number;
  closed_tickets: number;
}

export interface AllocationRow {
  person_id: string;
  project_id: string;
  project_name: string;
  pct: number;
  hours: number;
}

export interface OpenTicketRow {
  id: string;
  jira_key: string;
  summary: string;
  assignee_person_id: string | null;
  original_estimate_seconds: number | null;
  /** Jira's own lifetime total logged time on this ticket (all-time, not sprint-scoped) -- not dependent on the assignee keeping a remaining-estimate field up to date. */
  time_spent_seconds: number;
  sprint_id: string | null;
  is_blocked: boolean;
  /** Raw Jira status name (e.g. "Testing", "In Progress") -- status_category alone can't tell a ticket in QA/Testing apart from one still being coded. */
  status: string;
}

export interface WorklogTicketRow {
  ticket_id: string;
}

export interface SprintWorklogRow {
  ticket_id: string;
  author_person_id: string | null;
  seconds: number;
}

export interface HygieneRow {
  ticket_id: string;
  jira_key: string;
  summary: string;
  status: string;
  person_id: string | null;
  person_name: string | null;
  missing_estimate: boolean;
  missing_epic: boolean;
  missing_comments: boolean;
  missing_worklog: boolean;
}

export interface PersonHistoryRow {
  computed_at: string;
  pace_pct: number;
  bandwidth_hours: number;
  estimate_accuracy: number | null;
}

export interface PersonDetailTicket {
  key: string;
  title: string;
  status: string;
  projectId: string | null;
  projectName: string | null;
  estimate: number | null;
  remaining: number | null;
  // `logged` is scoped to THIS person's own worklogs, not the ticket's
  // total. A ticket that changed hands mid-sprint appears on both the
  // former and current owner's board, each with only their own hours --
  // `isAssignee` says which one currently holds it in Jira.
  logged: number;
  isAssignee: boolean;
  updated: string;
}

// current/upcoming only -- the RPC doesn't compute this for `completed`
// (resolved_ticket_history has no per-day worklog breakdown to draw from).
export interface ActiveWorkTicket extends PersonDetailTicket {
  // Hours logged against this ticket yesterday (the org's IST calendar day
  // before today), regardless of author -- lets Active work surface what
  // was actually worked on most recently. 0 for a ticket untouched
  // yesterday, not just "logged": undefined -- always present.
  loggedYesterday: number;
}

export interface PersonDetail {
  id: string;
  name: string;
  current: ActiveWorkTicket[];
  upcoming: ActiveWorkTicket[];
  completed: (PersonDetailTicket & { projectName: string | null })[];
  // Done tickets still sitting live in `tickets` for a currently-tracked
  // sprint (same RPC field engineering-ethos's Data Gaps panel reads) --
  // unlike `completed` (backed by resolved_ticket_history), this doesn't
  // depend on Jira's Resolution field being set on the way to Done, which
  // several boards' workflows never do. Without this, "Completed this
  // sprint" reads empty for anyone whose recent work is on such a board,
  // even though the tickets are genuinely Done (found live: Shreya
  // Kumari's ACX board never sets Resolution, so `completed` was always
  // empty for her despite 9 real Done tickets this sprint).
  completedThisSprint: {
    key: string;
    title: string;
    projectName: string | null;
    isAssignee: boolean;
  }[];
}

export interface ProjectDetailBlocker {
  ticket: string;
  title: string;
  since: string;
  owner: string | null;
  priority: string | null;
}

export interface ProjectDetailTicket {
  key: string;
  title: string;
  status: string;
  assignee: string | null;
  estimate: number | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  purpose: string | null;
  summary: string | null;
  sprintGoal: string | null;
  currentSprintTickets: ProjectDetailTicket[];
  progress: number | null;
  delivered: {
    name: string;
    date: string | null;
    hours: number;
    tickets: string[];
    description: string | null;
  }[];
  risks: { blockers: ProjectDetailBlocker[]; missingEstimates: number };
}

export interface SprintRow {
  name: string;
  start_date: string | null;
  end_date: string | null;
}

export interface AdjustmentRow {
  person_id: string;
  leave_days_this_sprint: number;
  note: string | null;
}

export interface PlanningAvailabilityRow {
  id: string;
  person_id: string;
  from_date: string;
  to_date: string;
  hours: number;
  notes: string | null;
}

export type PlanningAvailabilityInput = Omit<PlanningAvailabilityRow, "id">;

// One issue sitting in a board's NEXT (future-state) sprint -- see
// useNextSprintTickets.
export interface NextSprintTicketRow {
  jira_key: string;
  jira_project_key: string;
  board_name: string;
  jira_sprint_id: number;
  sprint_name: string;
  /** Jira usually leaves a future sprint's dates empty until it starts. */
  sprint_start_date: string | null;
  sprint_end_date: string | null;
  sprint_goal: string | null;
  summary: string;
  issue_type: string | null;
  status: string;
  priority: string | null;
  /** Null for an unassigned ticket, or an assignee that isn't in `people`. */
  assignee_person_id: string | null;
  assignee_name: string | null;
  original_estimate_seconds: number | null;
}

// ---------- Hooks ----------
export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: () => api<{ id: string; name: string }[]>("teams"),
  });
}

export function usePeopleOverview() {
  return useQuery({ queryKey: ["people-overview"], queryFn: () => api<PersonRow[]>("people") });
}

export function useProjectsOverview() {
  return useQuery({
    queryKey: ["projects-overview"],
    queryFn: () => api<ProjectRow[]>("projects"),
  });
}

// Every project's contributor breakdown, fetched in bulk -- avoids an N+1
// query when computing per-person spillage share and per-project contributor names.
export function usePersonAllocations() {
  return useQuery({
    queryKey: ["person-allocations"],
    queryFn: () => api<AllocationRow[]>("allocations"),
  });
}

// Ids (+ each one's own start_date) of the sprints each Jira board is
// currently tracking -- at most one per board (enforced by a unique partial
// index). "This sprint" anywhere in this app means a ticket whose sprint_id
// is one of these, same convention v_projects_overview/v_ticket_hygiene
// already use for their own scoping. start_date is carried along so
// allocatedHours can judge "logged before vs during this ticket's own
// sprint" per-ticket (see computeSprintHours in emp-engine.ts) rather than
// against one shared global cutoff -- boards run staggered, unaligned
// sprint cadences, mirroring engineering-ethos's own activeSprintIds
// treatment (confirmed live against the shared DB).
export interface TrackedSprintRow {
  id: string;
  start_date: string;
}
export function useTrackedSprintIds() {
  return useQuery({
    queryKey: ["tracked-sprint-ids"],
    queryFn: () => api<TrackedSprintRow[]>("tracked-sprints"),
  });
}

// Hand-maintained real leave/absence records -- the sync job already
// prorates each person's sprint capacity target against this, but the app
// wasn't reading or displaying it. Read-only from the client: RLS restricts
// writes to the sync job's service_role key (see migration 0008), so this
// table is maintained directly in Supabase, not through this app's UI.
export function useAdjustments() {
  return useQuery({
    queryKey: ["adjustments"],
    queryFn: () => api<AdjustmentRow[]>("adjustments"),
  });
}

// All open (non-done) tickets org-wide, INCLUDING their sprint_id -- callers
// must further filter to useTrackedSprintIds() before treating these as
// "this sprint's" work; a ticket can sit open for many sprints past its own
// board's currently-tracked one.
export function useOpenTickets() {
  return useQuery({
    queryKey: ["open-tickets"],
    queryFn: () => api<OpenTicketRow[]>("open-tickets"),
  });
}

// Done tickets currently sitting in one of the tracked sprints -- Jira
// boards often empty out (everything moved to Done) on the sprint's last
// day, before anyone clicks "Complete Sprint". Those tickets drop out of
// useOpenTickets() the moment they're done, so without this, a person's
// loggedHours/utilisation would collapse to 0 on that last day even though
// a full sprint of real work happened -- see computeSprintHours, which
// folds these in so hours logged against a ticket before it was finished
// still count as this sprint's work, right up until the sprint is
// genuinely marked complete (i.e. it drops out of trackedSprintIds).
export function useSprintDoneTickets(trackedSprintIds: string[]) {
  return useQuery({
    queryKey: ["sprint-done-tickets", trackedSprintIds],
    enabled: trackedSprintIds.length > 0,
    queryFn: () =>
      api<OpenTicketRow[]>(
        "sprint-done-tickets?sprintIds=" + encodeURIComponent(trackedSprintIds.join(",")),
      ),
  });
}

// Ticket ids that have at least one worklog, ever -- paired with
// useOpenTickets() to compute "missing worklog" per person in bulk.
export function useWorklogTicketIds() {
  return useQuery({
    queryKey: ["worklog-ticket-ids"],
    queryFn: () => api<WorklogTicketRow[]>("worklog-ticket-ids"),
  });
}

// Worklogs timestamped on/after the sprint start -- "logged this sprint"
// means logged since the sprint kicked off, not all-time (an all-time total
// on a spillover ticket would double-count work already credited to a prior sprint).
export function useSprintWorklogs(sprintStartIso: string | null) {
  return useQuery({
    queryKey: ["sprint-worklogs", sprintStartIso ?? ""],
    enabled: !!sprintStartIso,
    queryFn: () =>
      api<SprintWorklogRow[]>("sprint-worklogs?since=" + encodeURIComponent(sprintStartIso!)),
  });
}

export interface AllWorklogRow {
  ticket_id: string;
  author_person_id: string | null;
  started_at: string;
  seconds: number;
}

// Every worklog, unscoped by date -- ported from engineering-ethos's
// useAllWorklogs. allocatedHours needs each ticket's logging split into
// "before its own tracked sprint started" vs "on/after" (see
// computeSprintHours), which a single date-filtered fetch like
// useSprintWorklogs can't provide.
export function useAllWorklogs() {
  return useQuery({
    queryKey: ["all-worklogs"],
    queryFn: () => api<AllWorklogRow[]>("all-worklogs"),
  });
}

export function useTicketHygiene() {
  return useQuery({
    queryKey: ["ticket-hygiene"],
    queryFn: () => api<HygieneRow[]>("ticket-hygiene"),
  });
}

export function usePersonDetail(personId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["person-detail", personId ?? ""],
    enabled: enabled && !!personId,
    queryFn: () => api<PersonDetail>("people/" + encodeURIComponent(personId!)),
  });
}

export function useProjectDetail(slug: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["project-detail", slug ?? ""],
    enabled: enabled && !!slug,
    queryFn: () => api<ProjectDetail>("projects/" + encodeURIComponent(slug!)),
  });
}

// Recent daily sync snapshots for one person -- the real stand-in for the
// mock's per-sprint Performance History (the 5 boards' sprints run on
// materially the same calendar window, so a shared date-labelled trend is
// meaningful even though there's no single global "sprint 41-44").
export function usePersonHistory(personId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["person-history", personId ?? ""],
    enabled: enabled && !!personId,
    queryFn: () => api<PersonHistoryRow[]>("person-history/" + encodeURIComponent(personId!)),
  });
}

// The Planning page's ad-hoc availability log -- multiple arbitrary
// date-ranged entries per person, distinct from `adjustments`'s single
// leave-days-per-sprint count (see migration 0038). Entries overlapping the
// current sprint reduce displayed capacity client-side (see buildEmployees
// in emp-engine.ts), but this never feeds the sync job's computeMetrics() --
// it doesn't touch the `adjustments`/`people` numbers engineering-ethos and
// summit-read read, so this table stays invisible to those two dashboards.
export function usePlanningAvailability() {
  return useQuery({
    queryKey: ["planning-availability"],
    queryFn: () => api<PlanningAvailabilityRow[]>("planning-availability"),
  });
}

// Issues already placed in each board's next (future-state) sprint -- a
// snapshot the Jira sync replaces wholesale every run (migration 0069). Kept
// out of `tickets` on purpose: that table, and every view over it, is scoped
// to tracked (active) sprints, so "this sprint" numbers never include
// next-sprint work. Read-only from the client.
export function useNextSprintTickets() {
  return useQuery({
    queryKey: ["next-sprint-tickets"],
    queryFn: () => api<NextSprintTicketRow[]>("next-sprint-tickets"),
  });
}

export function useAddPlanningAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanningAvailabilityInput) =>
      api<PlanningAvailabilityRow[]>("planning-availability", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-availability"] }),
  });
}

export function useUpdatePlanningAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: PlanningAvailabilityRow) =>
      api<PlanningAvailabilityRow[]>("planning-availability/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-availability"] }),
  });
}

export function useDeletePlanningAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>("planning-availability/" + encodeURIComponent(id), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-availability"] }),
  });
}

// Kicks off an incremental Jira sync immediately via the same GitHub Actions
// workflow the daily cron uses, instead of waiting for the next scheduled
// run. Doesn't invalidate any queries itself -- the sync runs in CI and
// takes longer than a request round-trip, so there's nothing fresh to
// re-fetch the moment this resolves.
export function useTriggerJiraSync() {
  return useMutation({
    mutationFn: () => api<{ triggeredAt: string }>("jira-sync", { method: "POST" }),
  });
}

// The currently-tracked sprint whose length is closest to the org's 10-workday
// policy -- same "canonical sprint" pick used by v_canonical_sprint, just
// read directly here for the Dashboard title.
export function useCanonicalSprint() {
  return useQuery({
    queryKey: ["canonical-sprint"],
    queryFn: () => api<SprintRow[]>("canonical-sprint"),
  });
}

// v_team_sprint_summaries/v_org_sprint_summaries (0068) -- historical
// capacity/utilisation per team per sprint, rolled up from
// person_sprint_summaries (the same append-only record the People page's
// history chart reads). Unlike v_exec_capacity (live, current sprint
// only), these cover every sprint that's ever been snapshotted.
export interface TeamSprintSummaryRow {
  team: "Development" | "Infrastructure" | "Telephony";
  sprint_start: string;
  sprint_end: string;
  person_count: number;
  sprint_workdays: number;
  total_productive_hours: number;
  allocated_hours: number;
  logged_hours: number;
  capacity_used_pct: number;
  utilisation_pct: number;
  avg_pace_score: number | null;
  avg_estimate_score: number | null;
  avg_hygiene_score: number | null;
  avg_overall_score: number | null;
  // The org-sprint bucket this row was grouped into -- two teams' own
  // min(sprint_start) for the same conceptual org sprint can differ by
  // minutes (non-aligned boards), so chart/group by this, not sprint_start.
  group_day: string;
}

export interface OrgSprintSummaryRow {
  sprint_start: string;
  sprint_end: string;
  person_count: number;
  sprint_workdays: number;
  total_productive_hours: number;
  allocated_hours: number;
  logged_hours: number;
  capacity_used_pct: number;
  utilisation_pct: number;
}

export function useTeamSprintSummaries() {
  return useQuery({
    queryKey: ["team-sprint-summaries"],
    queryFn: () => api<TeamSprintSummaryRow[]>("team-sprint-summaries"),
  });
}

export function useOrgSprintSummaries() {
  return useQuery({
    queryKey: ["org-sprint-summaries"],
    queryFn: () => api<OrgSprintSummaryRow[]>("org-sprint-summaries"),
  });
}
