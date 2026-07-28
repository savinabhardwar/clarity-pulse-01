// Shared UI-facing type definitions. This module used to also export
// hardcoded mock data (people/projects/etc.) and derived-helper
// functions (contributorsOf, ownershipOf, teamStats, orgMetrics, ...) --
// all of that now comes from src/data/queries.ts, backed by live
// Supabase queries. Only the type shapes remain here, since components
// like Avatar/HealthBadge in primitives.tsx are typed against them.

export type Health = "On Track" | "Needs Attention" | "At Risk";

export interface Allocation {
  projectId: string;
  pct: number;
  hours: number;
}

export interface Ticket {
  key: string;
  title: string;
  projectId: string;
  status: "In Progress" | "In Review" | "QA" | "Blocked" | "To Do" | "Done";
  priority: "Critical" | "Highest" | "High" | "Medium" | "Low" | "Lowest";
  estimate: number | null;
  logged: number;
  updated: string;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  team: string;
  initials: string;
  utilisation: number;
  bandwidthHours: number;
  hoursLogged: number;
  estimatedHours: number;
  velocity: number;
  estimateAccuracy: number;
  estimateCoverage: number;
  worklogs: number;
  commentCount: number;
  idleDays: number;
  darkWip: number;
  health: Health;
  riskFlags: string[];
  allocations: Allocation[];
  current: Ticket[];
  upcoming: Ticket[];
  completed: Ticket[];
  comments: { ticket: string; text: string; when: string }[];
  timeline: { when: string; text: string }[];
  updates: string[];
}

export interface Initiative {
  name: string;
  summary: string;
  progress: number;
  issues: {
    key: string;
    title: string;
    status: Ticket["status"];
    assignee: string;
    estimate: number;
  }[];
}

export interface Capability {
  name: string;
  description: string;
  sprint: string;
  date: string;
  tickets: string[];
  hours: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  purpose: string;
  summary: string;
  health: Health;
  progress: number;
  sprint: string;
  sprintGoal: string;
  ownerId: string;
  teams: string[];
  hoursInvested: number;
  hoursThisSprint: number;
  remainingEstimate: number;
  velocity: number;
  openTickets: number;
  closedTickets: number;
  blockedTickets: number;
  initiatives: Initiative[];
  delivered: Capability[];
  risks: {
    blockers: {
      ticket: string;
      title: string;
      since: string;
      days: number;
      owner: string;
      priority: Ticket["priority"];
    }[];
    dependencies: string[];
    missingEstimates: number;
    staleTickets: number;
  };
  timeline: { sprint: string; capability: string; date: string }[];
  activity: {
    when: string;
    text: string;
    kind: "released" | "completed" | "blocked" | "qa" | "merged" | "update";
  }[];
}
