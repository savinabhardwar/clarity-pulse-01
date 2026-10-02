import { format } from "date-fns";
import type { Team } from "./emp-data";
import {
  OVERSIZED_TICKET_HOURS,
  SPRINT_CAPACITY_HOURS,
  SPRINT_LENGTH_DAYS,
  TEAMS,
} from "./emp-data";
import { round, type EmployeeMetrics } from "./emp-engine";
import type { NextSprintTicketRow, PlanningAvailabilityRow } from "@/data/queries";

const OVERSIZED_TICKET_SECONDS = OVERSIZED_TICKET_HOURS * 3600;

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function nextWorkdayAfter(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  do {
    x.setDate(x.getDate() + 1);
  } while (isWeekend(x));
  return x;
}

// `start` itself counts as workday 1, so n = SPRINT_LENGTH_DAYS - 1 lands on
// the last day of a full sprint.
function addWorkdays(start: Date, n: number): Date {
  const x = new Date(start);
  let left = n;
  while (left > 0) {
    x.setDate(x.getDate() + 1);
    if (!isWeekend(x)) left--;
  }
  return x;
}

export type SprintWindow = {
  /** yyyy-MM-dd, same shape as planning_availability's from/to dates. */
  start: string;
  end: string;
  /** True when Jira had no dates and the window was derived instead. */
  estimated: boolean;
};

/**
 * The calendar window a next sprint will run over. Jira normally leaves a
 * future sprint's dates empty until it starts, so when they're missing the
 * sprint is assumed to start the workday after the current sprint ends (or
 * after today, if the current sprint has already overrun its end date) and
 * to last a standard SPRINT_LENGTH_DAYS workdays.
 */
export function sprintWindow(
  startIso: string | null,
  endIso: string | null,
  currentSprintEndIso: string | null,
  today: Date = new Date(),
): SprintWindow {
  if (startIso && endIso) {
    return { start: ymd(new Date(startIso)), end: ymd(new Date(endIso)), estimated: false };
  }
  const currentEnd = currentSprintEndIso ? new Date(currentSprintEndIso) : today;
  const anchor = currentEnd > today ? currentEnd : today;
  const start = nextWorkdayAfter(anchor);
  return {
    start: ymd(start),
    end: ymd(addWorkdays(start, SPRINT_LENGTH_DAYS - 1)),
    estimated: true,
  };
}

const estimateHours = (t: NextSprintTicketRow) => (t.original_estimate_seconds ?? 0) / 3600;
const isOversized = (t: NextSprintTicketRow) =>
  (t.original_estimate_seconds ?? 0) > OVERSIZED_TICKET_SECONDS;
const isMissingEstimate = (t: NextSprintTicketRow) => t.original_estimate_seconds == null;

/** Hours that count toward a person's/team's plan: oversized tickets are flagged for breakdown instead, matching the rest of the app. */
const plannedHoursOf = (tickets: NextSprintTicketRow[]) =>
  round(tickets.filter((t) => !isOversized(t)).reduce((s, t) => s + estimateHours(t), 0));

export type NextSprintBoard = {
  sprintId: number;
  board: string;
  sprintName: string;
  goal: string | null;
  window: SprintWindow;
  tickets: number;
  plannedHours: number;
  /** Distinct rostered people with at least one ticket in this sprint. */
  people: number;
  noOwner: number;
};

export type PersonPlanStatus = "On Track" | "Needs Attention" | "At Risk" | "No work planned";

export type PersonPlan = {
  id: string;
  name: string;
  team: Team;
  tickets: NextSprintTicketRow[];
  plannedHours: number;
  /** Recorded leave overlapping this person's next sprint window(s). */
  leaveHours: number;
  /** SPRINT_CAPACITY_HOURS minus leaveHours. */
  capacityHours: number;
  /** capacityHours - plannedHours; negative means over-planned. */
  freeHours: number;
  loadPct: number;
  status: PersonPlanStatus;
  missingEstimates: number;
  oversized: number;
};

export type TeamPlan = {
  team: Team;
  engineers: number;
  plannedHours: number;
  capacityHours: number;
  freeHours: number;
  loadPct: number;
};

export type NextSprintPlan = {
  /** Tickets in scope for the current global filters. */
  tickets: NextSprintTicketRow[];
  boards: NextSprintBoard[];
  people: PersonPlan[];
  teams: TeamPlan[];
  /** No assignee, or an assignee who isn't on the active roster. */
  noOwner: NextSprintTicketRow[];
  missingEstimates: NextSprintTicketRow[];
  oversized: NextSprintTicketRow[];
  totals: {
    tickets: number;
    /** Owned work only -- compares like-for-like with capacityHours. */
    plannedHours: number;
    /** Estimated hours on tickets with no owner; not in plannedHours or any person's load. */
    noOwnerHours: number;
    capacityHours: number;
    freeHours: number;
  };
};

/**
 * Turns the next-sprint ticket snapshot into a capacity check.
 *
 * - `allPeople` decides who counts as "owned": a ticket whose assignee isn't
 *   on the active roster (unassigned, or someone since excluded) has no owner
 *   and is flagged rather than attributed.
 * - `visiblePeople` is the globally-filtered subset the page shows. Owned
 *   tickets are limited to those people; ownerless tickets only show while no
 *   filter is narrowing the view (they belong to nobody in particular).
 * - Capacity is the same fixed business rule as the rest of the app
 *   (SPRINT_CAPACITY_HOURS) minus planning_availability entries overlapping
 *   the window of the sprint(s) that person is planned in, counting an
 *   overlapping entry's full `hours` -- the convention buildEmployees uses.
 *   `adjustments.leave_days_this_sprint` is deliberately not used: it's the
 *   CURRENT sprint's leave.
 */
export function buildNextSprintPlan({
  tickets,
  allPeople,
  visiblePeople,
  filtersActive,
  availability,
  currentSprintEnd,
  today = new Date(),
}: {
  tickets: NextSprintTicketRow[];
  allPeople: EmployeeMetrics[];
  visiblePeople: EmployeeMetrics[];
  filtersActive: boolean;
  availability: PlanningAvailabilityRow[];
  currentSprintEnd: string | null;
  today?: Date;
}): NextSprintPlan {
  const rosterIds = new Set(allPeople.map((p) => p.id));
  const visibleIds = new Set(visiblePeople.map((p) => p.id));
  const hasOwner = (t: NextSprintTicketRow) =>
    t.assignee_person_id != null && rosterIds.has(t.assignee_person_id);

  const inScope = tickets.filter((t) =>
    hasOwner(t) ? visibleIds.has(t.assignee_person_id!) : !filtersActive,
  );

  // One window per sprint, computed from the unfiltered snapshot so a board's
  // dates don't shift when a filter is applied.
  const windowBySprint = new Map<number, SprintWindow>();
  for (const t of tickets) {
    if (!windowBySprint.has(t.jira_sprint_id)) {
      windowBySprint.set(
        t.jira_sprint_id,
        sprintWindow(t.sprint_start_date, t.sprint_end_date, currentSprintEnd, today),
      );
    }
  }
  const defaultWindow =
    [...windowBySprint.values()].sort((a, b) => a.start.localeCompare(b.start))[0] ??
    sprintWindow(null, null, currentSprintEnd, today);

  const boardTickets = new Map<number, NextSprintTicketRow[]>();
  for (const t of inScope) {
    (
      boardTickets.get(t.jira_sprint_id) ??
      boardTickets.set(t.jira_sprint_id, []).get(t.jira_sprint_id)!
    ).push(t);
  }
  const boards: NextSprintBoard[] = [...boardTickets.entries()]
    .map(([sprintId, list]) => ({
      sprintId,
      // Every ticket in a sprint carries the same denormalized sprint columns.
      board: list[0]!.board_name,
      sprintName: list[0]!.sprint_name,
      goal: list[0]!.sprint_goal,
      window: windowBySprint.get(sprintId)!,
      tickets: list.length,
      plannedHours: plannedHoursOf(list),
      people: new Set(list.filter(hasOwner).map((t) => t.assignee_person_id)).size,
      noOwner: list.filter((t) => !hasOwner(t)).length,
    }))
    .sort((a, b) => a.board.localeCompare(b.board));

  const ticketsByPerson = new Map<string, NextSprintTicketRow[]>();
  for (const t of inScope) {
    if (!hasOwner(t)) continue;
    const id = t.assignee_person_id!;
    (ticketsByPerson.get(id) ?? ticketsByPerson.set(id, []).get(id)!).push(t);
  }
  const availabilityByPerson = new Map<string, PlanningAvailabilityRow[]>();
  for (const a of availability) {
    (
      availabilityByPerson.get(a.person_id) ??
      availabilityByPerson.set(a.person_id, []).get(a.person_id)!
    ).push(a);
  }

  const people: PersonPlan[] = visiblePeople
    .map((p) => {
      const mine = ticketsByPerson.get(p.id) ?? [];
      // Someone planned into several boards' sprints is judged over the span
      // those sprints cover together.
      const windows = mine.length
        ? [...new Set(mine.map((t) => t.jira_sprint_id))].map((id) => windowBySprint.get(id)!)
        : [defaultWindow];
      const winStart = windows.map((w) => w.start).sort()[0]!;
      const winEnd = windows
        .map((w) => w.end)
        .sort()
        .at(-1)!;
      const leaveHours = round(
        (availabilityByPerson.get(p.id) ?? [])
          .filter((a) => a.from_date <= winEnd && a.to_date >= winStart)
          .reduce((s, a) => s + a.hours, 0),
      );
      const capacityHours = round(Math.max(0, SPRINT_CAPACITY_HOURS - leaveHours));
      const plannedHours = plannedHoursOf(mine);
      const loadPct = capacityHours
        ? Math.round((plannedHours / capacityHours) * 100)
        : plannedHours > 0
          ? 100
          : 0;
      const status: PersonPlanStatus =
        mine.length === 0
          ? "No work planned"
          : loadPct >= 100
            ? "At Risk"
            : loadPct >= 85
              ? "Needs Attention"
              : "On Track";
      return {
        id: p.id,
        name: p.name,
        team: p.team,
        tickets: mine,
        plannedHours,
        leaveHours,
        capacityHours,
        freeHours: round(capacityHours - plannedHours),
        loadPct,
        status,
        missingEstimates: mine.filter(isMissingEstimate).length,
        oversized: mine.filter(isOversized).length,
      };
    })
    .sort((a, b) => b.loadPct - a.loadPct || a.name.localeCompare(b.name));

  const teams: TeamPlan[] = TEAMS.map((team) => {
    const list = people.filter((p) => p.team === team);
    const plannedHours = round(list.reduce((s, p) => s + p.plannedHours, 0));
    const capacityHours = round(list.reduce((s, p) => s + p.capacityHours, 0));
    return {
      team,
      engineers: list.length,
      plannedHours,
      capacityHours,
      freeHours: round(capacityHours - plannedHours),
      loadPct: capacityHours ? Math.round((plannedHours / capacityHours) * 100) : 0,
    };
  });

  const noOwner = inScope.filter((t) => !hasOwner(t));
  const plannedTotal = round(people.reduce((s, p) => s + p.plannedHours, 0));
  const capacityTotal = round(people.reduce((s, p) => s + p.capacityHours, 0));

  return {
    tickets: inScope,
    boards,
    people,
    teams,
    noOwner,
    missingEstimates: inScope.filter(isMissingEstimate),
    oversized: inScope.filter(isOversized),
    totals: {
      tickets: inScope.length,
      plannedHours: plannedTotal,
      noOwnerHours: plannedHoursOf(noOwner),
      capacityHours: capacityTotal,
      freeHours: round(capacityTotal - plannedTotal),
    },
  };
}

export const ticketEstimateHours = (t: NextSprintTicketRow) =>
  t.original_estimate_seconds == null ? null : round(t.original_estimate_seconds / 3600);
