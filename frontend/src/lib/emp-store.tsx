import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useState } from "react";
import type { Team } from "./emp-data";
import { EXCLUDED_PEOPLE } from "./emp-data";
import { buildEmployees, type EmployeeMetrics } from "./emp-engine";
import {
  useAdjustments,
  useAllWorklogs,
  useCanonicalSprint,
  useOpenTickets,
  usePeopleOverview,
  usePersonAllocations,
  usePlanningAvailability,
  useProjectsOverview,
  useSprintDoneTickets,
  useSprintWorklogs,
  useTrackedSprintIds,
  useWorklogTicketIds,
  type AdjustmentRow,
  type AllocationRow,
  type ProjectRow,
} from "@/data/queries";

export type Filters = {
  team: Team | "All";
  project: string;
  employee: string;
};

type Ctx = {
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  /** Filtered by team/project/employee — for individual, employee-level views. */
  people: EmployeeMetrics[];
  /** Filtered by team/project only — for team-level rollups, so picking one employee doesn't collapse team-wide panels. */
  teamPeople: EmployeeMetrics[];
  allPeople: EmployeeMetrics[];
  projects: ProjectRow[];
  allocations: AllocationRow[];
  adjustments: AdjustmentRow[];
  isLoading: boolean;
  error: Error | null;
};

const defaults: Filters = {
  team: "All",
  project: "All",
  employee: "All",
};

const StoreContext = createContext<Ctx | null>(null);

export function EmStoreProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<Filters>(defaults);

  const peopleQuery = usePeopleOverview();
  const projectsQuery = useProjectsOverview();
  const allocationsQuery = usePersonAllocations();
  const openTicketsQuery = useOpenTickets();
  const worklogIdsQuery = useWorklogTicketIds();
  const canonicalSprintQuery = useCanonicalSprint();
  const sprintStartIso = canonicalSprintQuery.data?.[0]?.start_date ?? null;
  const sprintEndIso = canonicalSprintQuery.data?.[0]?.end_date ?? null;
  const sprintWorklogsQuery = useSprintWorklogs(sprintStartIso);
  const trackedSprintIdsQuery = useTrackedSprintIds();
  const trackedSprintIdsList = useMemo(
    () => (trackedSprintIdsQuery.data ?? []).map((s) => s.id),
    [trackedSprintIdsQuery.data],
  );
  const doneTicketsQuery = useSprintDoneTickets(trackedSprintIdsList);
  const adjustmentsQuery = useAdjustments();
  const planningAvailabilityQuery = usePlanningAvailability();
  const allWorklogsQuery = useAllWorklogs();

  const isLoading =
    peopleQuery.isLoading ||
    projectsQuery.isLoading ||
    allocationsQuery.isLoading ||
    openTicketsQuery.isLoading ||
    worklogIdsQuery.isLoading ||
    canonicalSprintQuery.isLoading ||
    sprintWorklogsQuery.isLoading ||
    trackedSprintIdsQuery.isLoading ||
    doneTicketsQuery.isLoading ||
    adjustmentsQuery.isLoading ||
    planningAvailabilityQuery.isLoading ||
    allWorklogsQuery.isLoading;
  const error = (peopleQuery.error ||
    projectsQuery.error ||
    allocationsQuery.error ||
    openTicketsQuery.error ||
    worklogIdsQuery.error ||
    canonicalSprintQuery.error ||
    sprintWorklogsQuery.error ||
    trackedSprintIdsQuery.error ||
    doneTicketsQuery.error ||
    adjustmentsQuery.error ||
    planningAvailabilityQuery.error ||
    allWorklogsQuery.error) as Error | null;

  const value = useMemo<Ctx>(() => {
    const projects = projectsQuery.data ?? [];
    const allocations = allocationsQuery.data ?? [];
    const adjustments = adjustmentsQuery.data ?? [];
    const worklogTicketIds = new Set((worklogIdsQuery.data ?? []).map((w) => w.ticket_id));
    // "This sprint" means a ticket whose sprint_id is one of the currently
    // tracked sprints -- a ticket can sit open for many sprints past its own
    // board's tracked one, and those shouldn't count as this sprint's work.
    const trackedSprintIds = new Set((trackedSprintIdsQuery.data ?? []).map((s) => s.id));
    const sprintScopedOpenTickets = (openTicketsQuery.data ?? []).filter(
      (t) => t.sprint_id != null && trackedSprintIds.has(t.sprint_id),
    );
    // Already scoped server-side to trackedSprintIds (see
    // useSprintDoneTickets), but re-filter defensively in case the tracked
    // set has since shifted underneath an in-flight query.
    const sprintScopedDoneTickets = (doneTicketsQuery.data ?? []).filter(
      (t) => t.sprint_id != null && trackedSprintIds.has(t.sprint_id),
    );
    const allPeople = buildEmployees(
      (peopleQuery.data ?? []).filter((p) => !EXCLUDED_PEOPLE.has(p.name)),
      allocations,
      sprintScopedOpenTickets,
      sprintScopedDoneTickets,
      worklogTicketIds,
      sprintWorklogsQuery.data ?? [],
      adjustments,
      planningAvailabilityQuery.data ?? [],
      sprintStartIso,
      sprintEndIso,
      trackedSprintIdsQuery.data ?? [],
      allWorklogsQuery.data ?? [],
    );
    const teamPeople = allPeople.filter(
      (p) =>
        (filters.team === "All" || p.team === filters.team) &&
        (filters.project === "All" || p.projects.includes(filters.project)),
    );
    const people = teamPeople.filter(
      (p) => filters.employee === "All" || p.id === filters.employee,
    );
    return {
      filters,
      setFilters: (f) => setFiltersState((prev) => ({ ...prev, ...f })),
      resetFilters: () => setFiltersState(defaults),
      people,
      teamPeople,
      allPeople,
      projects,
      allocations,
      adjustments,
      isLoading,
      error,
    };
  }, [
    filters,
    peopleQuery.data,
    projectsQuery.data,
    allocationsQuery.data,
    openTicketsQuery.data,
    doneTicketsQuery.data,
    worklogIdsQuery.data,
    sprintWorklogsQuery.data,
    trackedSprintIdsQuery.data,
    adjustmentsQuery.data,
    planningAvailabilityQuery.data,
    allWorklogsQuery.data,
    sprintStartIso,
    sprintEndIso,
    isLoading,
    error,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useEm() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useEm must be used inside EmStoreProvider");
  return ctx;
}

export const filteredProjects = (
  f: Filters,
  projects: ProjectRow[],
  allocations: AllocationRow[],
) => {
  const projectSpaceTeam = (p: ProjectRow) =>
    p.project_space === "infra"
      ? "Infrastructure"
      : p.project_space === "telephony"
        ? "Telephony"
        : "Development";
  return projects.filter(
    (p) =>
      (f.team === "All" || projectSpaceTeam(p) === f.team) &&
      (f.project === "All" || p.name === f.project) &&
      (f.employee === "All" ||
        allocations.some((a) => a.person_id === f.employee && a.project_id === p.id)),
  );
};
