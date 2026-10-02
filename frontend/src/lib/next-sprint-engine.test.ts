import { describe, expect, it } from "vitest";
import type { NextSprintTicketRow, PlanningAvailabilityRow } from "@/data/queries";
import type { EmployeeMetrics } from "./emp-engine";
import { buildNextSprintPlan, sprintWindow, ticketEstimateHours } from "./next-sprint-engine";

// Wednesday 2026-09-30; the current sprint ends Friday 2026-10-02. Times are
// midday UTC so the calendar date is the same in any timezone the tests run in.
const TODAY = new Date(2026, 8, 30);
const CURRENT_END = "2026-10-02T12:00:00Z";

const person = (id: string, name: string, team: EmployeeMetrics["team"] = "Development") =>
  ({ id, name, team }) as EmployeeMetrics;

const ticket = (
  key: string,
  sprintId: number,
  owner: string | null,
  hours: number | null,
  extra: Partial<NextSprintTicketRow> = {},
): NextSprintTicketRow => ({
  jira_key: key,
  jira_project_key: "KH",
  board_name: "Knowledge Hub",
  jira_sprint_id: sprintId,
  sprint_name: `KH Sprint ${sprintId}`,
  sprint_start_date: null,
  sprint_end_date: null,
  sprint_goal: null,
  summary: `${key} summary`,
  issue_type: "Task",
  status: "To Do",
  priority: null,
  assignee_person_id: owner,
  assignee_name: owner,
  original_estimate_seconds: hours == null ? null : hours * 3600,
  ...extra,
});

const leave = (
  personId: string,
  from: string,
  to: string,
  hours: number,
): PlanningAvailabilityRow => ({
  id: `${personId}-${from}`,
  person_id: personId,
  from_date: from,
  to_date: to,
  hours,
  notes: null,
});

const plan = (
  overrides: Partial<Parameters<typeof buildNextSprintPlan>[0]> & {
    tickets: NextSprintTicketRow[];
    allPeople: EmployeeMetrics[];
  },
) =>
  buildNextSprintPlan({
    visiblePeople: overrides.allPeople,
    filtersActive: false,
    availability: [],
    currentSprintEnd: CURRENT_END,
    today: TODAY,
    ...overrides,
  });

describe("sprintWindow", () => {
  it("uses Jira's dates when both are set", () => {
    expect(
      sprintWindow("2026-10-06T12:00:00Z", "2026-10-17T12:00:00Z", CURRENT_END, TODAY),
    ).toEqual({ start: "2026-10-06", end: "2026-10-17", estimated: false });
  });

  it("starts the workday after the current sprint ends and spans 10 workdays when undated", () => {
    // Fri 10-02 ends the current sprint -> Mon 10-05 .. Fri 10-16.
    expect(sprintWindow(null, null, CURRENT_END, TODAY)).toEqual({
      start: "2026-10-05",
      end: "2026-10-16",
      estimated: true,
    });
  });

  it("starts after today when the current sprint has already overrun its end date", () => {
    expect(sprintWindow(null, null, "2026-09-20T12:00:00Z", TODAY).start).toBe("2026-10-01");
  });

  it("skips the weekend when the anchor is a Friday", () => {
    const friday = new Date(2026, 9, 2);
    expect(sprintWindow(null, null, null, friday).start).toBe("2026-10-05");
  });

  it("falls back to today when there is no current sprint", () => {
    expect(sprintWindow(null, null, null, TODAY)).toEqual({
      start: "2026-10-01",
      end: "2026-10-14",
      estimated: true,
    });
  });

  it("treats a start date without an end date as undated", () => {
    expect(sprintWindow("2026-10-06T12:00:00Z", null, CURRENT_END, TODAY).estimated).toBe(true);
  });
});

describe("buildNextSprintPlan", () => {
  const alice = person("a", "Alice");
  const bob = person("b", "Bob", "Telephony");
  const carol = person("c", "Carol");
  const allPeople = [alice, bob, carol];

  const tickets = [
    ticket("KH-1", 11, "a", 30),
    ticket("KH-2", 11, "a", 30),
    ticket("KH-3", 11, "b", 10),
    ticket("KH-4", 11, "gone", 8), // assignee isn't on the roster
    ticket("KH-5", 11, null, 5), // unassigned
    ticket("KH-6", 11, "b", null), // no estimate
    ticket("KH-7", 11, "b", 50), // over the oversized threshold
  ];

  it("sums planned hours per person against capacity net of overlapping leave", () => {
    const result = plan({
      tickets,
      allPeople,
      availability: [
        leave("a", "2026-10-12", "2026-10-14", 21), // inside the estimated window
        leave("b", "2026-09-01", "2026-09-05", 35), // long before it
      ],
    });
    const byId = Object.fromEntries(result.people.map((p) => [p.id, p]));

    expect(byId["a"]).toMatchObject({
      plannedHours: 60,
      leaveHours: 21,
      capacityHours: 49,
      freeHours: -11,
      loadPct: 122,
      status: "At Risk",
    });
    expect(byId["b"]).toMatchObject({ leaveHours: 0, capacityHours: 70 });
  });

  it("leaves oversized and unestimated tickets out of planned hours but flags them", () => {
    const result = plan({ tickets, allPeople });
    const bobPlan = result.people.find((p) => p.id === "b");

    expect(bobPlan).toMatchObject({ plannedHours: 10, missingEstimates: 1, oversized: 1 });
    expect(result.missingEstimates.map((t) => t.jira_key)).toEqual(["KH-6"]);
    expect(result.oversized.map((t) => t.jira_key)).toEqual(["KH-7"]);
  });

  it("treats unassigned and off-roster assignees as having no owner, outside anyone's load", () => {
    const result = plan({ tickets, allPeople });

    expect(result.noOwner.map((t) => t.jira_key).sort()).toEqual(["KH-4", "KH-5"]);
    expect(result.totals.noOwnerHours).toBe(13);
    // Owned work only: 60 (Alice) + 10 (Bob).
    expect(result.totals.plannedHours).toBe(70);
    expect(result.totals.capacityHours).toBe(210);
  });

  it.each([
    ["no tickets", 0, "No work planned"],
    ["under 85%", 50, "On Track"],
    ["85% or more", 60, "Needs Attention"],
    ["100% or more", 70, "At Risk"],
  ] as const)("status for %s", (_label, hours, status) => {
    // 70h capacity; a single ticket can't exceed 35h, so split the load.
    const split =
      hours === 0
        ? []
        : [
            ticket("KH-1", 11, "a", Math.min(hours, 35)),
            ticket("KH-2", 11, "a", hours - Math.min(hours, 35)),
          ];
    const result = plan({ tickets: split, allPeople: [alice] });
    expect(result.people[0]?.status).toBe(status);
  });

  it("reports full-leave capacity as 0h and never divides by zero", () => {
    const result = plan({
      tickets: [ticket("KH-1", 11, "a", 5)],
      allPeople: [alice],
      availability: [leave("a", "2026-10-05", "2026-10-16", 70)],
    });
    expect(result.people[0]).toMatchObject({
      capacityHours: 0,
      loadPct: 100,
      status: "At Risk",
    });
  });

  it("sorts people most-loaded first", () => {
    const result = plan({ tickets, allPeople });
    expect(result.people.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("rolls people up into their team", () => {
    const result = plan({ tickets, allPeople });
    const dev = result.teams.find((t) => t.team === "Development");
    const tel = result.teams.find((t) => t.team === "Telephony");

    expect(dev).toMatchObject({ engineers: 2, plannedHours: 60, capacityHours: 140 });
    expect(tel).toMatchObject({ engineers: 1, plannedHours: 10, capacityHours: 70 });
  });

  it("groups boards by sprint, counting people and ownerless tickets", () => {
    const result = plan({
      tickets: [
        ...tickets,
        ticket("TT-1", 21, "c", 20, { jira_project_key: "TT", board_name: "Team - Telephony" }),
      ],
      allPeople,
    });

    expect(result.boards.map((b) => b.board)).toEqual(["Knowledge Hub", "Team - Telephony"]);
    expect(result.boards[0]).toMatchObject({
      sprintId: 11,
      tickets: 7,
      people: 2,
      noOwner: 2,
      plannedHours: 83,
    });
    expect(result.boards[1]).toMatchObject({ tickets: 1, people: 1, noOwner: 0, plannedHours: 20 });
  });

  it("counts leave that overlaps any of the sprints someone is planned in", () => {
    const result = plan({
      tickets: [
        ticket("KH-1", 11, "a", 10, {
          sprint_start_date: "2026-10-05T12:00:00Z",
          sprint_end_date: "2026-10-16T12:00:00Z",
        }),
        ticket("TT-1", 21, "a", 10, {
          jira_project_key: "TT",
          board_name: "Team - Telephony",
          sprint_start_date: "2026-10-19T12:00:00Z",
          sprint_end_date: "2026-10-30T12:00:00Z",
        }),
      ],
      allPeople: [alice],
      // Only overlaps the second sprint's dates.
      availability: [leave("a", "2026-10-26", "2026-10-27", 14)],
    });
    expect(result.people[0]).toMatchObject({ leaveHours: 14, capacityHours: 56 });
  });

  it("checks idle people's leave against the earliest next-sprint window", () => {
    const result = plan({
      tickets: [ticket("KH-1", 11, "a", 10)],
      allPeople: [alice, carol],
      availability: [leave("c", "2026-10-06", "2026-10-07", 14)],
    });
    expect(result.people.find((p) => p.id === "c")).toMatchObject({
      leaveHours: 14,
      capacityHours: 56,
      status: "No work planned",
    });
  });

  describe("with global filters active", () => {
    const filtered = () => plan({ tickets, allPeople, visiblePeople: [bob], filtersActive: true });

    it("limits tickets and people to the filtered set", () => {
      const result = filtered();
      expect(result.tickets.map((t) => t.jira_key).sort()).toEqual(["KH-3", "KH-6", "KH-7"]);
      expect(result.people.map((p) => p.id)).toEqual(["b"]);
    });

    it("hides ownerless tickets, which belong to no filtered view", () => {
      expect(filtered().noOwner).toEqual([]);
    });

    it("still shows ownerless tickets when a person is visible but no filter is active", () => {
      const result = plan({ tickets, allPeople, visiblePeople: [bob], filtersActive: false });
      expect(result.noOwner).toHaveLength(2);
    });
  });
});

describe("ticketEstimateHours", () => {
  it("converts seconds to hours, and keeps 'no estimate' distinct from 0h", () => {
    expect(ticketEstimateHours(ticket("KH-1", 11, null, 2.5))).toBe(2.5);
    expect(ticketEstimateHours(ticket("KH-2", 11, null, 0))).toBe(0);
    expect(ticketEstimateHours(ticket("KH-3", 11, null, null))).toBeNull();
  });
});
