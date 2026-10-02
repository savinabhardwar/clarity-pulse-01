import type { Team } from "./emp-data";
import {
  OVERSIZED_TICKET_HOURS,
  SPRINT_CAPACITY_HOURS,
  SPRINT_DAILY_HOURS,
  SPRINT_LENGTH_DAYS,
  TEAMS,
} from "./emp-data";
import type {
  AdjustmentRow,
  AllocationRow,
  AllWorklogRow,
  DbHealth,
  OpenTicketRow,
  PersonRow,
  PlanningAvailabilityRow,
  ProjectRow,
  SprintWorklogRow,
  TrackedSprintRow,
} from "@/data/queries";

export const round = (n: number) => Math.round(n * 100) / 100;

const OVERSIZED_TICKET_SECONDS = OVERSIZED_TICKET_HOURS * 3600;

// Statuses where the assignee's own work is effectively done -- it's sitting
// with QA/reviewer now, so it shouldn't keep counting toward that person's
// outstanding/allocated hours even though Jira hasn't moved it to "done" yet.
const HANDED_OFF_STATUSES = new Set(["Testing"]);

// Statuses excluded from remainingWorkHours (and, by extension,
// remainingCapacity/spillage) on top of HANDED_OFF_STATUSES -- work nobody
// is currently planning to do this sprint shouldn't project as
// outstanding/spillage-risk. Deprioritised tickets keep their normal
// allocatedHours treatment (that KPI answers "what did the sprint commit
// to," a different question) -- this only affects the forward-looking
// remaining-work/spillage projection.
const REMAINING_WORK_EXCLUDED_STATUSES = new Set([...HANDED_OFF_STATUSES, "Deprioritised"]);

const HEALTH_MAP: Record<DbHealth, "On Track" | "Needs Attention" | "At Risk"> = {
  on_track: "On Track",
  needs_attention: "Needs Attention",
  at_risk: "At Risk",
};
export function toHealth(h: DbHealth) {
  return HEALTH_MAP[h] ?? "On Track";
}

// Collapses the 5 raw Jira-board team names into the 3 business-facing
// buckets this app is organized around -- same convention as
// v_projects_overview.project_space (migration 0020).
export function teamGroup(teamName: string | null): Team {
  if (teamName === "Team - Infrastructure") return "Infrastructure";
  if (teamName === "Team - Telephony") return "Telephony";
  return "Development";
}

export function projectSpaceToTeam(space: ProjectRow["project_space"]): Team {
  if (space === "infra") return "Infrastructure";
  if (space === "telephony") return "Telephony";
  return "Development";
}

export type OversizedTicket = { key: string; title: string; estimateHours: number };

/**
 * Recomputes one person's sprint hours straight from raw tickets + worklogs,
 * instead of trusting the DB's own pre-aggregated estimated_hours/bandwidth_hours
 * (which don't apply the oversized-ticket rule and weren't matching expectations):
 *
 * - Tickets whose ORIGINAL estimate exceeds OVERSIZED_TICKET_HOURS are excluded
 *   from allocated/logged hours entirely and returned separately as
 *   oversizedTickets, to flag rather than silently fold into the totals.
 * - Blocked tickets (tk.is_blocked) are excluded from allocated/logged hours
 *   the same way, and returned separately as blockedTickets: work nobody can
 *   actually progress shouldn't count toward capacity math. This re-includes
 *   itself automatically the moment the sync's next run picks up the ticket
 *   getting unblocked in Jira -- no separate handling needed, since this
 *   function always reads whatever is_blocked value the latest fetch has.
 * - Tickets in a hand-off status (HANDED_OFF_STATUSES, e.g. "Testing") are
 *   excluded from remainingWorkHours only: once a ticket hands off, there's
 *   no more forward work left for the assignee, so it shouldn't project as
 *   outstanding/spillage-risk work for them even though the ticket isn't
 *   status_category=done yet. It still counts toward allocatedHours below --
 *   the time already spent on it was real, allocated effort and shouldn't
 *   disappear from that total just because the ticket moved on. Unlike
 *   oversized/blocked tickets these aren't flagged separately -- they just
 *   switch from remaining-estimate to spent-time in allocatedHours, and drop
 *   out of remainingWorkHours entirely.
 * - allocatedHours is ported straight from engineering-ethos's own
 *   computeSprintHours (confirmed live against the shared DB, then adopted
 *   here so both apps tell the same allocation/utilisation story), and
 *   answers a different question from remainingWorkHours below: "how much
 *   did this sprint commit to and actually spend," not "how much is still
 *   outstanding right now." Per ticket (open OR done -- see allOwned):
 *     - Done: full original_estimate_seconds, always -- the sprint
 *       committed to this much work and it got finished, regardless of
 *       exactly how the hours landed relative to plan.
 *     - Blocked, or in a hand-off status (Testing): not actionable/no
 *       further effort of the assignee's is going into it, so its estimate
 *       never counts -- but whatever THIS SPRINT's own worklogs (judged
 *       against the ticket's OWN tracked sprint's start_date, since boards
 *       run staggered, unaligned cadences) actually logged against it still
 *       counts as real, spent allocation.
 *     - Otherwise (actively open, still in flight): original_estimate_seconds
 *       minus whatever was already logged against it BEFORE this ticket's
 *       own sprint started (any author, any earlier sprint) -- a fixed
 *       "committed to this sprint" total that does NOT shrink as hours get
 *       logged during the sprint (that comparison is what loggedHours/pace
 *       are for). A ticket with no pre-sprint logging at all keeps its full
 *       original estimate.
 *   Needs trackedSprints (each tracked sprint's own start_date) and
 *   allWorklogs (every worklog, unscoped by date) to judge "before vs
 *   during this ticket's own sprint" -- see useTrackedSprintIds/
 *   useAllWorklogs.
 * - remainingWorkHours is the forward-looking twin used for
 *   remaining-capacity/spillage projections: original_estimate_seconds -
 *   time_spent_seconds clamped at 0 for still-open, non-blocked tickets not
 *   in REMAINING_WORK_EXCLUDED_STATUSES (hand-off statuses like Testing,
 *   plus Deprioritised), 0 for those -- that time is no longer "remaining"
 *   for planning purposes even though a hand-off ticket still counts as
 *   allocated above (Deprioritised tickets keep their normal allocatedHours
 *   treatment either way -- only this forward-looking figure excludes
 *   them). Deliberately NOT changed alongside allocatedHours -- Spillage is
 *   a separate, still-outstanding-work measure this port doesn't touch.
 * - loggedHours (returned separately, shown on the People page detail view)
 *   only counts worklogs scoped to the current sprint (see useSprintWorklogs)
 *   -- a different, sprint-local number from the all-time time_spent_seconds
 *   used above, kept distinct on purpose. It's judged against BOTH open
 *   tickets and `doneTickets` (this sprint's Done tickets, still sitting in
 *   a tracked sprint -- see useSprintDoneTickets): a Jira board often empties
 *   out entirely on the sprint's last day, before anyone clicks "Complete
 *   Sprint", and hours logged against a ticket right up until it was
 *   finished are real work done this sprint, not work that should vanish
 *   the moment the ticket leaves useOpenTickets.
 */
export function computeSprintHours(
  tickets: OpenTicketRow[],
  doneTickets: OpenTicketRow[],
  sprintWorklogs: SprintWorklogRow[],
  trackedSprints: TrackedSprintRow[],
  allWorklogs: AllWorklogRow[],
  personId: string,
): {
  allocatedHours: number;
  remainingWorkHours: number;
  loggedHours: number;
  oversizedTickets: OversizedTicket[];
  blockedTickets: OversizedTicket[];
} {
  const owned = tickets.filter((t) => t.assignee_person_id === personId && !t.is_blocked);
  const blocked = tickets.filter((t) => t.assignee_person_id === personId && t.is_blocked);
  const ownedDone = doneTickets.filter((t) => t.assignee_person_id === personId && !t.is_blocked);
  const sized = owned.filter((t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS);
  const oversized = owned.filter(
    (t) => (t.original_estimate_seconds ?? 0) > OVERSIZED_TICKET_SECONDS,
  );
  // Done tickets never contribute to remainingWorkHours (their outstanding
  // work is correctly 0 -- that's what "done" means), but their worklogs
  // still count toward loggedHours, so their ids join sizedIds below.
  const sizedDone = ownedDone.filter(
    (t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS,
  );
  const sizedIds = new Set([...sized, ...sizedDone].map((t) => t.id));

  const remainingSeconds = (t: OpenTicketRow) =>
    Math.max(0, (t.original_estimate_seconds ?? 0) - (t.time_spent_seconds ?? 0));

  const remainingWorkHours =
    sized
      .filter((t) => !REMAINING_WORK_EXCLUDED_STATUSES.has(t.status))
      .reduce((s, t) => s + remainingSeconds(t), 0) / 3600;
  const loggedHours =
    sprintWorklogs
      .filter((w) => w.author_person_id === personId && sizedIds.has(w.ticket_id))
      .reduce((s, w) => s + w.seconds, 0) / 3600;

  // --- allocatedHours: ported from engineering-ethos's computeSprintHours ---
  // (see the doc comment above). Judges "before vs during this ticket's own
  // sprint" per ticket, against that sprint's own start_date -- not the one
  // global sprintWorklogs cutoff the rest of this function uses.
  const sprintStartMsById = new Map(
    trackedSprints.map((s) => [s.id, new Date(s.start_date).getTime()]),
  );
  const ownSprintStartMs = (t: OpenTicketRow) =>
    t.sprint_id ? (sprintStartMsById.get(t.sprint_id) ?? null) : null;
  const allWorklogsByTicket = new Map<string, AllWorklogRow[]>();
  for (const w of allWorklogs) {
    const list = allWorklogsByTicket.get(w.ticket_id);
    if (list) list.push(w);
    else allWorklogsByTicket.set(w.ticket_id, [w]);
  }
  const loggedThisSprintSeconds = (t: OpenTicketRow) => {
    const ownStart = ownSprintStartMs(t);
    if (ownStart === null) return 0;
    return (allWorklogsByTicket.get(t.id) ?? [])
      .filter(
        (w) => w.author_person_id === personId && new Date(w.started_at).getTime() >= ownStart,
      )
      .reduce((sum, w) => sum + w.seconds, 0);
  };

  // Unlike remainingWorkHours/loggedHours above, allocatedHours' own owned
  // set includes blocked tickets (handled below via blockedForAllocation) --
  // engineering-ethos still credits their this-sprint logged effort.
  const ownedForAllocation = tickets.filter((t) => t.assignee_person_id === personId);
  const ownedDoneForAllocation = doneTickets.filter((t) => t.assignee_person_id === personId);
  const allOwnedForAllocation = [...ownedForAllocation, ...ownedDoneForAllocation];
  const doneIdsForAllocation = new Set(ownedDoneForAllocation.map((t) => t.id));
  const notOversized = (t: OpenTicketRow) =>
    (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS;
  const sizedForAllocation = allOwnedForAllocation.filter(
    (t) => notOversized(t) && !t.is_blocked && !HANDED_OFF_STATUSES.has(t.status),
  );
  const blockedForAllocation = allOwnedForAllocation.filter((t) => notOversized(t) && t.is_blocked);
  const handedOffForAllocation = allOwnedForAllocation.filter(
    (t) => notOversized(t) && !t.is_blocked && HANDED_OFF_STATUSES.has(t.status),
  );
  const blockedSizedSeconds = blockedForAllocation.reduce(
    (s, t) => s + loggedThisSprintSeconds(t),
    0,
  );
  const handedOffSizedSeconds = handedOffForAllocation.reduce(
    (s, t) => s + loggedThisSprintSeconds(t),
    0,
  );

  const allocatedHours =
    (sizedForAllocation.reduce((s, t) => {
      const original = t.original_estimate_seconds ?? 0;
      if (doneIdsForAllocation.has(t.id)) return s + original;
      const ownStart = ownSprintStartMs(t);
      const logs = allWorklogsByTicket.get(t.id) ?? [];
      const loggedBeforeSprint =
        ownStart === null
          ? 0
          : logs
              .filter((w) => new Date(w.started_at).getTime() < ownStart)
              .reduce((sum, w) => sum + w.seconds, 0);
      return s + Math.max(original - loggedBeforeSprint, 0);
    }, 0) +
      blockedSizedSeconds +
      handedOffSizedSeconds) /
    3600;

  return {
    allocatedHours: round(allocatedHours),
    remainingWorkHours: round(remainingWorkHours),
    loggedHours: round(loggedHours),
    oversizedTickets: oversized.map((t) => ({
      key: t.jira_key,
      title: t.summary,
      estimateHours: round((t.original_estimate_seconds ?? 0) / 3600),
    })),
    blockedTickets: blocked.map((t) => ({
      key: t.jira_key,
      title: t.summary,
      estimateHours: round(remainingSeconds(t) / 3600),
    })),
  };
}

export type EmployeeMetrics = {
  id: string;
  name: string;
  role: string;
  team: Team;
  projects: string[];
  pace: number;
  /** Fixed sprint capacity (7h/day x 10-day sprint), minus any recorded leave -- a business rule, not derived from tickets. */
  productiveHours: number;
  /** Hours of recorded leave this sprint, from the real adjustments table. */
  unavailableHours: number;
  leaveNote: string | null;
  /** Ported from engineering-ethos: hours committed to this sprint (Done tickets' full estimate, blocked/handed-off tickets' this-sprint logged time, else estimate minus pre-sprint logging) -- see computeSprintHours. */
  allocatedHours: number;
  /** Forward-looking outstanding work still to do: estimate minus all-time logged, on open, non-blocked, non-handed-off (Testing), non-Deprioritised tickets. Drives remainingCapacity/spillage below -- see computeSprintHours. */
  remainingWorkHours: number;
  /** Hours logged since the sprint started, on sized tickets only. */
  loggedHours: number;
  /** Workdays (Mon-Fri, today inclusive) left until the sprint ends, capped at SPRINT_LENGTH_DAYS. */
  daysRemaining: number;
  /** productiveHours scaled down to only the time still left in the sprint. */
  capacityHoursRemaining: number;
  /** capacityHoursRemaining minus outstanding allocated work -- negative means it won't fit in the time left. */
  remainingCapacity: number;
  utilisationPct: number;
  spillage: number;
  planningAccuracy: number;
  lastUpdatedDays: number;
  missingEstimates: number;
  missingWorklogs: number;
  staleItems: number;
  status: "On Track" | "Needs Attention" | "At Risk";
  riskFlags: string[];
  oversizedTickets: OversizedTicket[];
  /** Blocked (tk.is_blocked) tickets -- excluded from allocatedHours/loggedHours until unblocked. */
  blockedTickets: OversizedTicket[];
};

/**
 * Composes the bulk employee list from live Supabase rows: v_people_overview
 * for pace/health/risk signals, v_person_allocations for their project list,
 * and computeSprintHours (raw tickets + sprint-scoped worklogs) for
 * allocated/logged/remaining capacity -- excluding and flagging oversized
 * tickets rather than folding them into the totals.
 *
 * Capacity (productiveHours) starts from the fixed 70h/sprint business rule
 * and subtracts any recorded leave for that person this sprint: the real,
 * hand-maintained `adjustments` table (the same one the sync job already
 * prorates its own targets against), plus any `planning_availability` entry
 * whose date range overlaps the current sprint window (a client-side-only
 * subtraction -- it never touches the sync-persisted numbers those other two
 * dashboards read, see migration 0038). An overlapping entry counts its full
 * `hours` value regardless of how much of its range falls inside the sprint,
 * matching the existing leave_days_this_sprint model's lack of proration.
 * Spillage assumes a 100% pace on purpose -- it's "how much allocated work
 * doesn't fit in the time actually left this sprint even at perfect
 * execution," a pure over-allocation measure (mirrors remainingCapacity's
 * negative side, see below). Pace is a separate, independent signal (shown
 * alongside it, never multiplied into it), so the two never contradict each
 * other in a sentence.
 */
export function buildEmployees(
  people: PersonRow[],
  allocations: AllocationRow[],
  openTickets: OpenTicketRow[],
  doneTickets: OpenTicketRow[],
  worklogTicketIds: Set<string>,
  sprintWorklogs: SprintWorklogRow[],
  adjustments: AdjustmentRow[],
  planningAvailability: PlanningAvailabilityRow[],
  sprintStart: string | null,
  sprintEnd: string | null,
  trackedSprints: TrackedSprintRow[],
  allWorklogs: AllWorklogRow[],
): EmployeeMetrics[] {
  const allocationsByPerson = new Map<string, AllocationRow[]>();
  for (const a of allocations) {
    (
      allocationsByPerson.get(a.person_id) ??
      allocationsByPerson.set(a.person_id, []).get(a.person_id)!
    ).push(a);
  }
  const openTicketsByPerson = new Map<string, OpenTicketRow[]>();
  for (const t of openTickets) {
    if (!t.assignee_person_id) continue;
    (
      openTicketsByPerson.get(t.assignee_person_id) ??
      openTicketsByPerson.set(t.assignee_person_id, []).get(t.assignee_person_id)!
    ).push(t);
  }
  const adjustmentByPerson = new Map(adjustments.map((a) => [a.person_id, a]));
  const availabilityByPerson = new Map<string, PlanningAvailabilityRow[]>();
  for (const a of planningAvailability) {
    (
      availabilityByPerson.get(a.person_id) ??
      availabilityByPerson.set(a.person_id, []).get(a.person_id)!
    ).push(a);
  }
  const overlapsSprint = (fromDate: string, toDate: string) =>
    sprintStart != null && sprintEnd != null && fromDate <= sprintEnd && toDate >= sprintStart;

  const dayOnly = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const isWeekend = (d: Date) => {
    const day = d.getDay();
    return day === 0 || day === 6;
  };
  const countWorkdaysInclusive = (from: Date, to: Date) => {
    let n = 0;
    const cur = new Date(from);
    while (cur <= to) {
      if (!isWeekend(cur)) n++;
      cur.setDate(cur.getDate() + 1);
    }
    return n;
  };

  // Workdays (Mon-Fri) remaining between TODAY and the sprint end, today
  // INCLUSIVE -- today's hours haven't been spent yet, so they're still
  // real capacity available to do work, unlike the sync pipeline's
  // elapsed-side "asOf is already elapsed" convention (used for judging
  // progress SO FAR, a backward-looking question). Bandwidth/spillage ask a
  // forward-looking question instead -- "how much time is actually left to
  // still finish this" -- so today belongs on the remaining side of that
  // question, not the elapsed side. Capped at SPRINT_LENGTH_DAYS so a
  // sprint whose real calendar span runs longer than 10 workdays (holidays,
  // a delayed start) can't inflate capacity past the fixed business-rule
  // total. Falls back to a full sprint's worth when there's no canonical
  // sprint end to anchor against.
  const todayDayOnly = dayOnly(new Date());
  const sprintEndDayOnly = sprintEnd ? dayOnly(new Date(sprintEnd)) : null;
  let daysRemaining = SPRINT_LENGTH_DAYS;
  if (sprintEndDayOnly) {
    daysRemaining = Math.min(
      SPRINT_LENGTH_DAYS,
      Math.max(0, countWorkdaysInclusive(todayDayOnly, sprintEndDayOnly)),
    );
  }

  return people.map((p) => {
    const myAllocations = allocationsByPerson.get(p.id) ?? [];
    const myOpenTickets = openTicketsByPerson.get(p.id) ?? [];
    const missingEstimates = myOpenTickets.filter(
      (t) => t.original_estimate_seconds == null,
    ).length;
    const missingWorklogs = myOpenTickets.filter((t) => !worklogTicketIds.has(t.id)).length;
    const sprintHours = computeSprintHours(
      openTickets,
      doneTickets,
      sprintWorklogs,
      trackedSprints,
      allWorklogs,
      p.id,
    );
    const adjustment = adjustmentByPerson.get(p.id);
    const myAvailability = availabilityByPerson.get(p.id) ?? [];
    const availabilityHours = myAvailability
      .filter((a) => overlapsSprint(a.from_date, a.to_date))
      .reduce((sum, a) => sum + a.hours, 0);
    const unavailableHours = round(
      (adjustment?.leave_days_this_sprint ?? 0) * SPRINT_DAILY_HOURS + availabilityHours,
    );
    const productiveHours = round(Math.max(0, SPRINT_CAPACITY_HOURS - unavailableHours));
    // Time-aware: how much of this person's capacity is left given only the
    // workdays still remaining in the sprint (today inclusive -- see
    // daysRemaining above), set against remainingWorkHours -- which is
    // "work still outstanding" per Jira's own remaining_estimate, excluding
    // tickets that have already handed off (see computeSprintHours), not
    // allocatedHours' total committed hours. A negative result means their
    // outstanding work won't fit in the time left even before accounting
    // for pace.
    //
    // Unlike productiveHours above (a flat, whole-sprint total), this is
    // built day-by-day rather than proportionally scaling productiveHours
    // by daysRemaining/SPRINT_LENGTH_DAYS -- that proportional approach
    // silently assumed a person's recorded leave was spread evenly across
    // the WHOLE sprint, which breaks whenever leave is concentrated on
    // specific dates: someone on leave for exactly the days still remaining
    // was still credited a share of "remaining capacity" as if their leave
    // fell earlier in the sprint instead (found live: Irfan Basha, on leave
    // for the sprint's entire final week, still showed 14h of remaining
    // capacity via the proportional formula -- masking that he actually has
    // 0h left and his full remaining work is genuine spillage). Conversely,
    // leave already fully in the past kept reducing capacityHoursRemaining
    // it no longer should (found live: Shubham, whose only 2 leave days
    // were both before today, showed spillage the proportional formula
    // invented from leave that wasn't actually eating into his remaining
    // days at all). planning_availability rows have real from/to dates, so
    // their contribution is computed per-day and only counted for the
    // portion of the row that overlaps [today, sprintEnd]; a row's `hours`
    // is spread evenly across its own workdays first (a 5-workday, 35h row
    // is 7h/day) so a row split by today only loses the days actually still
    // ahead. adjustments.leave_days_this_sprint has no date, so it keeps
    // the old proportional treatment (best-effort, since there's nothing
    // more precise to anchor it to).
    let datedRemainingLeaveHours = 0;
    if (sprintEndDayOnly) {
      for (const row of myAvailability) {
        const rowStart = dayOnly(new Date(`${row.from_date}T00:00:00`));
        const rowEnd = dayOnly(new Date(`${row.to_date}T00:00:00`));
        const rowWorkdays = countWorkdaysInclusive(rowStart, rowEnd);
        if (rowWorkdays === 0) continue;
        const perDayRate = row.hours / rowWorkdays;
        const intersectStart = rowStart > todayDayOnly ? rowStart : todayDayOnly;
        const intersectEnd = rowEnd < sprintEndDayOnly ? rowEnd : sprintEndDayOnly;
        if (intersectStart > intersectEnd) continue;
        datedRemainingLeaveHours +=
          perDayRate * countWorkdaysInclusive(intersectStart, intersectEnd);
      }
    }
    const proportionalRemainingLeaveHours =
      (adjustment?.leave_days_this_sprint ?? 0) *
      SPRINT_DAILY_HOURS *
      (daysRemaining / SPRINT_LENGTH_DAYS);
    const remainingLeaveHours = round(datedRemainingLeaveHours + proportionalRemainingLeaveHours);
    const capacityHoursRemaining = round(
      Math.max(0, SPRINT_DAILY_HOURS * daysRemaining - remainingLeaveHours),
    );
    const remainingCapacity = round(capacityHoursRemaining - sprintHours.remainingWorkHours);
    // Mirrors remainingCapacity's negative side: how much outstanding work
    // won't fit in the time actually left, given perfect execution from here
    // on. Grows as the sprint runs out of days even if remainingWorkHours
    // never changes -- 20h of work is fine on day 1 (10 days x 7h left) but
    // spills 13h if it's still outstanding on the last day (1 day x 7h left).
    const spillage = round(Math.max(0, -remainingCapacity));

    return {
      id: p.id,
      name: p.name,
      role: p.role ?? "Engineer",
      team: teamGroup(p.team),
      projects: myAllocations.map((a) => a.project_name),
      pace: p.pace_pct,
      productiveHours,
      unavailableHours,
      leaveNote: adjustment?.note ?? null,
      allocatedHours: sprintHours.allocatedHours,
      remainingWorkHours: sprintHours.remainingWorkHours,
      loggedHours: sprintHours.loggedHours,
      daysRemaining,
      capacityHoursRemaining,
      remainingCapacity,
      utilisationPct: productiveHours
        ? Math.round((sprintHours.allocatedHours / productiveHours) * 100)
        : 0,
      spillage,
      planningAccuracy: p.estimate_accuracy ?? 0,
      lastUpdatedDays: p.idle_workdays,
      missingEstimates,
      missingWorklogs,
      staleItems: p.dark_wip_count,
      status: toHealth(p.health),
      riskFlags: p.risk_flags,
      oversizedTickets: sprintHours.oversizedTickets,
      blockedTickets: sprintHours.blockedTickets,
    };
  });
}

export type TeamMetrics = {
  team: Team;
  engineers: number;
  productiveHours: number;
  allocatedHours: number;
  unallocatedHours: number;
  capacityUsed: number;
  spillage: number;
};

export function teamMetrics(people: EmployeeMetrics[]): TeamMetrics[] {
  return TEAMS.map((team) => {
    const list = people.filter((p) => p.team === team);
    const productiveHours = round(list.reduce((s, p) => s + p.productiveHours, 0));
    const allocatedHours = round(list.reduce((s, p) => s + p.allocatedHours, 0));
    // Full-sprint basis (productiveHours - allocatedHours), NOT the
    // time-prorated remainingCapacity -- this KPI is meant to reconcile with
    // productiveHours/allocatedHours above (both full-sprint numbers), while
    // remainingCapacity/spillage/bandwidth (time-aware) live on the People
    // page as a separate, more urgent signal. Mixing the two bases here made
    // Allocated + Unallocated silently stop summing to Productive.
    const unallocatedHours = round(
      list.reduce((s, p) => s + Math.max(p.productiveHours - p.allocatedHours, 0), 0),
    );
    const spillage = round(list.reduce((s, p) => s + p.spillage, 0));
    const capacityUsed = productiveHours ? Math.round((allocatedHours / productiveHours) * 100) : 0;
    return {
      team,
      engineers: list.length,
      productiveHours,
      allocatedHours,
      unallocatedHours,
      capacityUsed,
      spillage,
    };
  });
}

export type ManagerAction = {
  subject: string;
  kind: "Person";
  severity: "High" | "Medium" | "Low";
  issue: string;
  action: string;
};

export function managerActions(
  people: EmployeeMetrics[],
  openTicketCountByPerson: Map<string, number>,
): ManagerAction[] {
  const out: ManagerAction[] = [];

  for (const p of people) {
    if ((openTicketCountByPerson.get(p.id) ?? 0) === 0) {
      out.push({
        subject: p.name,
        kind: "Person",
        severity: "Medium",
        issue: `No work planned for ${p.name} this sprint.`,
        action: "Assign sprint work or confirm they're supporting another team.",
      });
    }
    if (p.spillage > 0) {
      out.push({
        subject: p.name,
        kind: "Person",
        severity: p.spillage >= 15 ? "High" : p.spillage >= 5 ? "Medium" : "Low",
        issue: `${p.name} has ${p.spillage}h more outstanding work than fits in the time left this sprint — likely to spill regardless of pace.`,
        action: "Re-scope the work or move something to an engineer with capacity.",
      });
    }
    if (p.oversizedTickets.length > 0) {
      out.push({
        subject: p.name,
        kind: "Person",
        severity: "Low",
        issue: `${p.oversizedTickets.length} ticket${p.oversizedTickets.length === 1 ? "" : "s"} over ${OVERSIZED_TICKET_HOURS}h need${p.oversizedTickets.length === 1 ? "s" : ""} breakdown: ${p.oversizedTickets.map((t) => t.key).join(", ")}.`,
        action: "Break the ticket down before it can be tracked in a single sprint.",
      });
    }
  }

  const order = { High: 0, Medium: 1, Low: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function countOpenTicketsByPerson(openTickets: OpenTicketRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of openTickets) {
    if (!t.assignee_person_id) continue;
    counts.set(t.assignee_person_id, (counts.get(t.assignee_person_id) ?? 0) + 1);
  }
  return counts;
}

// Caps one person's allocatedHours at their own (leave-adjusted)
// productiveHours for KPI-card purposes only -- allocatedHours itself (see
// computeSprintHours) can legitimately exceed a person's own capacity
// (Done tickets keep their full estimate, blocked/handed-off tickets add
// this-sprint logged time on top), and EmployeeMetrics.allocatedHours/
// utilisationPct are left uncapped everywhere else (People page, manager
// actions, etc.) since overallocation past 100% is itself a real signal
// worth showing there. Only these org-wide KPI totals need the cap: without
// it, Total - Allocated no longer equals Unallocated, because each
// over-capacity person's excess doesn't carry over to offset anyone else's
// -- unallocated is summed as max(productiveHours - allocatedHours, 0) per
// person, so one person 20h over cap doesn't "use up" another person's
// slack, it just vanishes from the subtraction on their own row, inflating
// Unallocated relative to Total - Allocated (found live: 1683 - 1530.66 =
// 152.34, but Unallocated read 395.34). Capped at productiveHours, not a
// flat SPRINT_CAPACITY_HOURS -- for anyone with no recorded leave this
// sprint productiveHours IS 70h, so this only differs for the handful of
// people leave has reduced below 70h; capping those at a flat 70 still left
// a reconciliation gap on their rows (found live: Irfan Basha's real
// capacity is 35h, so 58h allocated capped at 70 still overshot by 23h).
const cappedAllocatedForKpi = (p: EmployeeMetrics) => Math.min(p.allocatedHours, p.productiveHours);

export function kpis(people: EmployeeMetrics[]) {
  const productive = round(people.reduce((s, p) => s + p.productiveHours, 0));
  const allocated = round(people.reduce((s, p) => s + cappedAllocatedForKpi(p), 0));
  // Full-sprint basis, matching teamMetrics() -- see its comment. Now
  // reconciles exactly with productive - allocated above, since capping
  // allocatedHours at each person's own productiveHours means it can never
  // exceed what that person contributes to the productive total.
  const unallocated = round(
    people.reduce((s, p) => s + Math.max(p.productiveHours - cappedAllocatedForKpi(p), 0), 0),
  );
  const spillage = round(people.reduce((s, p) => s + p.spillage, 0));
  const utilisation = productive ? Math.round((allocated / productive) * 100) : 0;
  return { productive, allocated, unallocated, spillage, utilisation };
}

// Distinct contributor names for one project, resolved from the bulk
// allocations + people lists already loaded for the page.
export function contributorsForProject(
  projectId: string,
  allocations: AllocationRow[],
  people: EmployeeMetrics[],
): string[] {
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const names = allocations
    .filter((a) => a.project_id === projectId)
    .map((a) => nameById.get(a.person_id))
    .filter((n): n is string => !!n);
  return Array.from(new Set(names)).sort();
}
