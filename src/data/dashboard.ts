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
  priority: "Critical" | "High" | "Medium" | "Low";
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
  issues: { key: string; title: string; status: Ticket["status"]; assignee: string; estimate: number }[];
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
    blockers: { ticket: string; title: string; since: string; days: number; owner: string; priority: Ticket["priority"] }[];
    dependencies: string[];
    missingEstimates: number;
    staleTickets: number;
  };
  timeline: { sprint: string; capability: string; date: string }[];
  activity: { when: string; text: string; kind: "released" | "completed" | "blocked" | "qa" | "merged" | "update" }[];
}

export const sprint = { name: "Sprint 12", day: 7, length: 10, progress: 68 };

export const projects: Project[] = [
  {
    id: "cx",
    name: "CX Messaging",
    color: "var(--chart-1)",
    purpose:
      "A unified customer conversation platform for support and success teams. It brings WhatsApp, web chat and email into one inbox so agents resolve issues without switching tools.",
    summary:
      "CX Messaging is currently being developed by seven engineers. This sprint focuses on Billing Configuration, WhatsApp enhancements and AI Suggested Replies. Since the project began, the team has delivered Workflow Builder, Embedded Chatbot, Speech-to-Text, Campaign Management and Knowledge Base URL Import. Current delivery is on schedule with one dependency affecting reporting APIs.",
    health: "Needs Attention",
    progress: 72,
    sprint: "Sprint 12",
    sprintGoal: "Ship Billing Configuration to QA and complete WhatsApp template approvals.",
    ownerId: "ashish",
    teams: ["Platform", "Conversational AI"],
    hoursInvested: 4820,
    hoursThisSprint: 268,
    remainingEstimate: 640,
    velocity: 34,
    openTickets: 41,
    closedTickets: 218,
    blockedTickets: 3,
    initiatives: [
      {
        name: "Billing Configuration",
        summary: "Self-serve plan, seat and usage configuration for workspace admins.",
        progress: 74,
        issues: [
          { key: "CX-812", title: "Plan selection and seat allocation UI", status: "QA", assignee: "Shreya Nair", estimate: 16 },
          { key: "CX-815", title: "Usage metering service integration", status: "In Progress", assignee: "Ashish Kumar", estimate: 24 },
          { key: "CX-818", title: "Invoice preview endpoint", status: "In Review", assignee: "Pavan Rao", estimate: 12 },
          { key: "CX-822", title: "Proration rules for mid-cycle upgrades", status: "To Do", assignee: "Sourav Das", estimate: 10 },
        ],
      },
      {
        name: "WhatsApp Integration",
        summary: "Template approvals, media messages and delivery receipts on the WhatsApp channel.",
        progress: 58,
        issues: [
          { key: "CX-790", title: "Template approval workflow", status: "In Progress", assignee: "Sophie Laurent", estimate: 20 },
          { key: "CX-793", title: "Media attachment pipeline", status: "Blocked", assignee: "Pavan Rao", estimate: 14 },
          { key: "CX-799", title: "Delivery + read receipt sync", status: "In Progress", assignee: "Shreya Nair", estimate: 12 },
        ],
      },
      {
        name: "AI Suggested Replies",
        summary: "Context-aware reply suggestions drawn from past resolutions and the knowledge base.",
        progress: 45,
        issues: [
          { key: "CX-830", title: "Reply ranking model integration", status: "In Progress", assignee: "Marta Silva", estimate: 28 },
          { key: "CX-834", title: "Inline suggestion component", status: "To Do", assignee: "Sophie Laurent", estimate: 16 },
        ],
      },
      {
        name: "Reporting APIs",
        summary: "Aggregated conversation and agent performance data for analytics consumers.",
        progress: 30,
        issues: [
          { key: "CX-770", title: "Conversation rollup materialised views", status: "Blocked", assignee: "Ashish Kumar", estimate: 18 },
          { key: "CX-776", title: "Agent performance endpoint", status: "To Do", assignee: "Sourav Das", estimate: 14 },
        ],
      },
    ],
    delivered: [
      { name: "Workflow Builder", description: "Drag-and-drop automation of conversation routing and escalation.", sprint: "Sprint 5", date: "12 Mar 2026", tickets: ["CX-410", "CX-418", "CX-425", "CX-431"], hours: 384 },
      { name: "Campaign Management", description: "Outbound campaign scheduling with audience segments.", sprint: "Sprint 6", date: "26 Mar 2026", tickets: ["CX-455", "CX-461", "CX-470"], hours: 296 },
      { name: "Embedded Chatbot", description: "Drop-in web widget with themed branding and handoff to agents.", sprint: "Sprint 7", date: "09 Apr 2026", tickets: ["CX-502", "CX-509", "CX-517"], hours: 342 },
      { name: "Speech-to-Text", description: "Voice call transcription with speaker separation.", sprint: "Sprint 8", date: "23 Apr 2026", tickets: ["CX-540", "CX-548"], hours: 268 },
      { name: "Knowledge Base from URL", description: "Crawl a documentation site and turn it into answerable content.", sprint: "Sprint 9", date: "14 May 2026", tickets: ["CX-585", "CX-590", "CX-596"], hours: 210 },
    ],
    risks: {
      blockers: [
        { ticket: "CX-793", title: "Media attachment pipeline blocked on vendor sandbox", since: "16 Jul 2026", days: 12, owner: "Pavan Rao", priority: "High" },
        { ticket: "CX-770", title: "Rollup views waiting on Data Platform schema", since: "20 Jul 2026", days: 8, owner: "Ashish Kumar", priority: "Critical" },
        { ticket: "CX-844", title: "Billing sandbox credentials expired", since: "24 Jul 2026", days: 4, owner: "Shreya Nair", priority: "Medium" },
      ],
      dependencies: ["Data Platform schema migration (reporting APIs)", "Vendor WhatsApp sandbox renewal"],
      missingEstimates: 6,
      staleTickets: 4,
    },
    timeline: [
      { sprint: "Sprint 5", capability: "Workflow Builder", date: "12 Mar 2026" },
      { sprint: "Sprint 6", capability: "Campaign Management", date: "26 Mar 2026" },
      { sprint: "Sprint 7", capability: "Embedded Chatbot", date: "09 Apr 2026" },
      { sprint: "Sprint 8", capability: "Speech-to-Text", date: "23 Apr 2026" },
      { sprint: "Sprint 9", capability: "Knowledge Base from URL", date: "14 May 2026" },
      { sprint: "Sprint 12", capability: "Billing Configuration (in progress)", date: "Expected 07 Aug 2026" },
    ],
    activity: [
      { when: "Today", text: "Billing Configuration entered QA", kind: "qa" },
      { when: "Today", text: "Workflow Builder 2.1 released to all workspaces", kind: "released" },
      { when: "Yesterday", text: "Speech Recognition improvements merged to main", kind: "merged" },
      { when: "Yesterday", text: "Knowledge Base URL Import completed", kind: "completed" },
      { when: "2 days ago", text: "CX-770 blocked by Data Platform schema migration", kind: "blocked" },
    ],
  },
  {
    id: "atlas",
    name: "Atlas Analytics",
    color: "var(--chart-2)",
    purpose:
      "The reporting layer behind every product surface. It gives operations leads self-serve dashboards over conversation, billing and agent data without asking engineering for extracts.",
    summary:
      "Atlas Analytics is being developed by four engineers. This sprint the team is finishing the Metrics Warehouse migration and the first version of Custom Dashboards. Delivered so far: Usage Explorer, Scheduled Exports and the Embedded Report Viewer. Delivery is on schedule and no contributor is overallocated.",
    health: "On Track",
    progress: 61,
    sprint: "Sprint 12",
    sprintGoal: "Complete warehouse cutover and ship Custom Dashboards behind a flag.",
    ownerId: "marta",
    teams: ["Data Platform"],
    hoursInvested: 2940,
    hoursThisSprint: 156,
    remainingEstimate: 520,
    velocity: 27,
    openTickets: 26,
    closedTickets: 131,
    blockedTickets: 1,
    initiatives: [
      {
        name: "Metrics Warehouse Migration",
        summary: "Move aggregation from application queries to a governed warehouse model.",
        progress: 80,
        issues: [
          { key: "AT-221", title: "Backfill conversation fact tables", status: "In Progress", assignee: "Marta Silva", estimate: 30 },
          { key: "AT-226", title: "Dual-write validation harness", status: "In Review", assignee: "Diego Alvarez", estimate: 18 },
          { key: "AT-229", title: "Cutover runbook", status: "To Do", assignee: "Marta Silva", estimate: 8 },
        ],
      },
      {
        name: "Custom Dashboards",
        summary: "Let operations leads compose their own metric tiles and share them.",
        progress: 42,
        issues: [
          { key: "AT-240", title: "Tile configuration schema", status: "In Progress", assignee: "Nadia Haddad", estimate: 22 },
          { key: "AT-244", title: "Dashboard sharing permissions", status: "To Do", assignee: "Diego Alvarez", estimate: 14 },
        ],
      },
      {
        name: "Query Performance",
        summary: "Cut p95 dashboard load time below two seconds.",
        progress: 55,
        issues: [
          { key: "AT-250", title: "Materialised view refresh scheduling", status: "In Progress", assignee: "Diego Alvarez", estimate: 16 },
          { key: "AT-253", title: "Result cache for shared dashboards", status: "Blocked", assignee: "Nadia Haddad", estimate: 12 },
        ],
      },
    ],
    delivered: [
      { name: "Usage Explorer", description: "Filterable exploration of workspace usage over time.", sprint: "Sprint 7", date: "09 Apr 2026", tickets: ["AT-110", "AT-118"], hours: 240 },
      { name: "Scheduled Exports", description: "Recurring CSV and Sheets delivery of any saved view.", sprint: "Sprint 9", date: "14 May 2026", tickets: ["AT-150", "AT-157", "AT-161"], hours: 198 },
      { name: "Embedded Report Viewer", description: "Read-only report embedding for customer-facing portals.", sprint: "Sprint 11", date: "10 Jul 2026", tickets: ["AT-190", "AT-196"], hours: 176 },
    ],
    risks: {
      blockers: [{ ticket: "AT-253", title: "Result cache pending infra capacity approval", since: "22 Jul 2026", days: 6, owner: "Nadia Haddad", priority: "Medium" }],
      dependencies: ["Infra capacity approval for cache cluster"],
      missingEstimates: 2,
      staleTickets: 1,
    },
    timeline: [
      { sprint: "Sprint 7", capability: "Usage Explorer", date: "09 Apr 2026" },
      { sprint: "Sprint 9", capability: "Scheduled Exports", date: "14 May 2026" },
      { sprint: "Sprint 11", capability: "Embedded Report Viewer", date: "10 Jul 2026" },
      { sprint: "Sprint 12", capability: "Metrics Warehouse (in progress)", date: "Expected 07 Aug 2026" },
    ],
    activity: [
      { when: "Today", text: "Dual-write validation harness moved to review", kind: "update" },
      { when: "Yesterday", text: "Embedded Report Viewer released to two pilot accounts", kind: "released" },
      { when: "3 days ago", text: "Conversation fact backfill reached 80%", kind: "update" },
    ],
  },
  {
    id: "orbit",
    name: "Orbit Onboarding",
    color: "var(--chart-3)",
    purpose:
      "The first-run experience for new workspaces. It guides admins from signup to a configured, live inbox so that sales does not have to run manual setup calls.",
    summary:
      "Orbit Onboarding is being developed by three engineers and is at risk. The sprint focuses on Guided Setup and Data Import, but two contributors are overallocated across CX Messaging and estimate coverage is the lowest of any project. Delivered so far: Signup Flow Redesign and Sample Data Seeding.",
    health: "At Risk",
    progress: 38,
    sprint: "Sprint 12",
    sprintGoal: "Get Guided Setup to an internally demoable state.",
    ownerId: "sophie",
    teams: ["Growth"],
    hoursInvested: 1180,
    hoursThisSprint: 92,
    remainingEstimate: 780,
    velocity: 15,
    openTickets: 33,
    closedTickets: 54,
    blockedTickets: 4,
    initiatives: [
      {
        name: "Guided Setup",
        summary: "A checklist-driven walkthrough covering channels, teammates and routing.",
        progress: 40,
        issues: [
          { key: "OR-88", title: "Setup checklist state machine", status: "In Progress", assignee: "Sophie Laurent", estimate: 24 },
          { key: "OR-91", title: "Channel connect steps", status: "Blocked", assignee: "Tomas Berg", estimate: 18 },
          { key: "OR-95", title: "Progress persistence", status: "To Do", assignee: "Tomas Berg", estimate: 10 },
        ],
      },
      {
        name: "Data Import",
        summary: "Bring historical conversations and contacts across from legacy helpdesks.",
        progress: 25,
        issues: [
          { key: "OR-102", title: "CSV contact importer", status: "In Progress", assignee: "Priya Menon", estimate: 20 },
          { key: "OR-106", title: "Zendesk conversation mapping", status: "To Do", assignee: "Priya Menon", estimate: 26 },
        ],
      },
      {
        name: "Activation Signals",
        summary: "Instrument the setup funnel so growth can see where admins drop off.",
        progress: 15,
        issues: [{ key: "OR-115", title: "Funnel event schema", status: "To Do", assignee: "Sophie Laurent", estimate: 12 }],
      },
    ],
    delivered: [
      { name: "Signup Flow Redesign", description: "Three-step signup with workspace provisioning in under a minute.", sprint: "Sprint 8", date: "23 Apr 2026", tickets: ["OR-30", "OR-36"], hours: 164 },
      { name: "Sample Data Seeding", description: "New workspaces start with realistic demo conversations.", sprint: "Sprint 10", date: "18 Jun 2026", tickets: ["OR-52", "OR-58"], hours: 96 },
    ],
    risks: {
      blockers: [
        { ticket: "OR-91", title: "Channel connect blocked on shared OAuth service", since: "10 Jul 2026", days: 18, owner: "Tomas Berg", priority: "Critical" },
        { ticket: "OR-118", title: "Import limits undefined by product", since: "18 Jul 2026", days: 10, owner: "Priya Menon", priority: "High" },
      ],
      dependencies: ["Shared OAuth service owned by Platform", "Product decision on import volume limits"],
      missingEstimates: 11,
      staleTickets: 7,
    },
    timeline: [
      { sprint: "Sprint 8", capability: "Signup Flow Redesign", date: "23 Apr 2026" },
      { sprint: "Sprint 10", capability: "Sample Data Seeding", date: "18 Jun 2026" },
      { sprint: "Sprint 12", capability: "Guided Setup (in progress)", date: "Expected 21 Aug 2026" },
    ],
    activity: [
      { when: "Today", text: "OR-91 escalated to Platform for OAuth support", kind: "blocked" },
      { when: "Yesterday", text: "CSV contact importer reached first working end-to-end run", kind: "update" },
      { when: "4 days ago", text: "Sample Data Seeding enabled for all trials", kind: "released" },
    ],
  },
  {
    id: "vault",
    name: "Vault Security",
    color: "var(--chart-4)",
    purpose:
      "Enterprise trust features required to close regulated accounts. It covers SSO, audit trails and data residency controls for security reviewers.",
    summary:
      "Vault Security is being developed by three engineers and is on schedule. This sprint covers SCIM Provisioning and Audit Log Export. Delivered so far: SAML SSO, Role Based Access Control and Session Policies. No blockers are currently open.",
    health: "On Track",
    progress: 55,
    sprint: "Sprint 12",
    sprintGoal: "Finish SCIM user lifecycle and start audit log export.",
    ownerId: "diego",
    teams: ["Platform"],
    hoursInvested: 1620,
    hoursThisSprint: 118,
    remainingEstimate: 420,
    velocity: 21,
    openTickets: 18,
    closedTickets: 87,
    blockedTickets: 0,
    initiatives: [
      {
        name: "SCIM Provisioning",
        summary: "Automatic user create, update and deactivate from customer identity providers.",
        progress: 65,
        issues: [
          { key: "VA-140", title: "SCIM user lifecycle endpoints", status: "In Progress", assignee: "Diego Alvarez", estimate: 26 },
          { key: "VA-144", title: "Group to role mapping", status: "In Review", assignee: "Tomas Berg", estimate: 14 },
        ],
      },
      {
        name: "Audit Log Export",
        summary: "Streaming and scheduled export of security events to customer SIEMs.",
        progress: 30,
        issues: [
          { key: "VA-150", title: "Event schema versioning", status: "In Progress", assignee: "Nadia Haddad", estimate: 16 },
          { key: "VA-153", title: "S3 destination connector", status: "To Do", assignee: "Diego Alvarez", estimate: 18 },
        ],
      },
    ],
    delivered: [
      { name: "SAML SSO", description: "Single sign-on with the major identity providers.", sprint: "Sprint 6", date: "26 Mar 2026", tickets: ["VA-40", "VA-47"], hours: 208 },
      { name: "Role Based Access Control", description: "Granular workspace roles and permission sets.", sprint: "Sprint 9", date: "14 May 2026", tickets: ["VA-72", "VA-79", "VA-84"], hours: 262 },
      { name: "Session Policies", description: "Configurable session lifetime and device revocation.", sprint: "Sprint 11", date: "10 Jul 2026", tickets: ["VA-101"], hours: 88 },
    ],
    risks: { blockers: [], dependencies: ["Identity provider certification review"], missingEstimates: 1, staleTickets: 0 },
    timeline: [
      { sprint: "Sprint 6", capability: "SAML SSO", date: "26 Mar 2026" },
      { sprint: "Sprint 9", capability: "Role Based Access Control", date: "14 May 2026" },
      { sprint: "Sprint 11", capability: "Session Policies", date: "10 Jul 2026" },
      { sprint: "Sprint 12", capability: "SCIM Provisioning (in progress)", date: "Expected 07 Aug 2026" },
    ],
    activity: [
      { when: "Today", text: "Group to role mapping opened for review", kind: "update" },
      { when: "2 days ago", text: "Session Policies rolled out to enterprise tier", kind: "released" },
    ],
  },
];

const t = (
  key: string,
  title: string,
  projectId: string,
  status: Ticket["status"],
  priority: Ticket["priority"],
  estimate: number | null,
  logged: number,
  updated: string,
): Ticket => ({ key, title, projectId, status, priority, estimate, logged, updated });

export const people: Person[] = [
  {
    id: "ashish",
    name: "Ashish Kumar",
    role: "Staff Engineer",
    team: "Platform",
    initials: "AK",
    utilisation: 92,
    bandwidthHours: 3,
    hoursLogged: 68,
    estimatedHours: 72,
    velocity: 9,
    estimateAccuracy: 94,
    estimateCoverage: 96,
    worklogs: 18,
    commentCount: 24,
    idleDays: 0,
    darkWip: 0,
    health: "On Track",
    riskFlags: [],
    allocations: [
      { projectId: "cx", pct: 62, hours: 42 },
      { projectId: "vault", pct: 30, hours: 20 },
    ],
    current: [
      t("CX-815", "Usage metering service integration", "cx", "In Progress", "High", 24, 15, "2h ago"),
      t("CX-770", "Conversation rollup materialised views", "cx", "Blocked", "Critical", 18, 9, "1d ago"),
    ],
    upcoming: [t("VA-153", "S3 destination connector", "vault", "To Do", "Medium", 18, 0, "—")],
    completed: [
      t("CX-596", "Knowledge base crawler hardening", "cx", "Done", "High", 14, 13, "2d ago"),
      t("VA-101", "Session revocation API", "vault", "Done", "Medium", 10, 11, "5d ago"),
    ],
    comments: [
      { ticket: "CX-770", text: "Waiting on Data Platform to confirm the new schema before we cut over.", when: "1d ago" },
      { ticket: "CX-815", text: "Metering events now flowing in staging, validating counts.", when: "3h ago" },
    ],
    timeline: [
      { when: "Today", text: "Logged 6h on Usage metering service integration" },
      { when: "Yesterday", text: "Escalated CX-770 dependency to Data Platform" },
      { when: "2 days ago", text: "Completed Knowledge base crawler hardening" },
    ],
    updates: ["Owns CX Messaging delivery", "Reviewing SCIM design for Vault"],
  },
  {
    id: "sophie",
    name: "Sophie Laurent",
    role: "Senior Engineer",
    team: "Growth",
    initials: "SL",
    utilisation: 128,
    bandwidthHours: -11,
    hoursLogged: 94,
    estimatedHours: 74,
    velocity: 7,
    estimateAccuracy: 68,
    estimateCoverage: 61,
    worklogs: 22,
    commentCount: 9,
    idleDays: 0,
    darkWip: 3,
    health: "At Risk",
    riskFlags: ["Exceeded planned capacity", "Dark WIP on 3 tickets", "Split across 3 projects"],
    allocations: [
      { projectId: "orbit", pct: 58, hours: 46 },
      { projectId: "cx", pct: 42, hours: 34 },
      { projectId: "atlas", pct: 28, hours: 14 },
    ],
    current: [
      t("OR-88", "Setup checklist state machine", "orbit", "In Progress", "High", 24, 31, "1h ago"),
      t("CX-790", "Template approval workflow", "cx", "In Progress", "High", 20, 22, "4h ago"),
      t("CX-834", "Inline suggestion component", "cx", "In Progress", "Medium", 16, 6, "1d ago"),
    ],
    upcoming: [t("OR-115", "Funnel event schema", "orbit", "To Do", "Medium", 12, 0, "—")],
    completed: [t("OR-58", "Demo conversation seeding", "orbit", "Done", "Medium", 12, 18, "6d ago")],
    comments: [{ ticket: "OR-88", text: "State machine is bigger than estimated, splitting into two tickets.", when: "5h ago" }],
    timeline: [
      { when: "Today", text: "Logged 9h across three projects" },
      { when: "Yesterday", text: "Flagged Guided Setup scope risk in standup" },
    ],
    updates: ["Over capacity for the second sprint running", "Needs work moved off Orbit or CX"],
  },
  {
    id: "shreya",
    name: "Shreya Nair",
    role: "Senior Engineer",
    team: "Platform",
    initials: "SN",
    utilisation: 86,
    bandwidthHours: 6,
    hoursLogged: 61,
    estimatedHours: 64,
    velocity: 8,
    estimateAccuracy: 91,
    estimateCoverage: 94,
    worklogs: 16,
    commentCount: 18,
    idleDays: 0,
    darkWip: 1,
    health: "On Track",
    riskFlags: [],
    allocations: [
      { projectId: "cx", pct: 74, hours: 46 },
      { projectId: "vault", pct: 12, hours: 8 },
    ],
    current: [
      t("CX-812", "Plan selection and seat allocation UI", "cx", "QA", "High", 16, 15, "3h ago"),
      t("CX-799", "Delivery + read receipt sync", "cx", "In Progress", "Medium", 12, 7, "1d ago"),
    ],
    upcoming: [t("CX-844", "Billing sandbox credential rotation", "cx", "To Do", "Medium", 6, 0, "—")],
    completed: [t("CX-590", "KB URL import UI", "cx", "Done", "High", 18, 17, "4d ago")],
    comments: [{ ticket: "CX-812", text: "QA found two edge cases on seat downgrade, fixes pushed.", when: "3h ago" }],
    timeline: [
      { when: "Today", text: "Moved Billing Configuration UI into QA" },
      { when: "3 days ago", text: "Delivered KB URL import UI" },
    ],
    updates: ["Strong estimate accuracy", "Can absorb a small piece of Vault work"],
  },
  {
    id: "pavan",
    name: "Pavan Rao",
    role: "Engineer",
    team: "Conversational AI",
    initials: "PR",
    utilisation: 71,
    bandwidthHours: 12,
    hoursLogged: 48,
    estimatedHours: 56,
    velocity: 6,
    estimateAccuracy: 82,
    estimateCoverage: 88,
    worklogs: 12,
    commentCount: 11,
    idleDays: 1,
    darkWip: 0,
    health: "On Track",
    riskFlags: ["One ticket blocked 12 days"],
    allocations: [{ projectId: "cx", pct: 71, hours: 48 }],
    current: [
      t("CX-793", "Media attachment pipeline", "cx", "Blocked", "High", 14, 8, "12d ago"),
      t("CX-818", "Invoice preview endpoint", "cx", "In Review", "Medium", 12, 11, "6h ago"),
    ],
    upcoming: [t("CX-822", "Proration rules for mid-cycle upgrades", "cx", "To Do", "Medium", 10, 0, "—")],
    completed: [t("CX-548", "Speaker separation tuning", "cx", "Done", "High", 16, 15, "8d ago")],
    comments: [{ ticket: "CX-793", text: "Vendor sandbox still down, chasing support daily.", when: "1d ago" }],
    timeline: [
      { when: "Today", text: "Invoice preview endpoint opened for review" },
      { when: "Yesterday", text: "Chased vendor on blocked media pipeline" },
    ],
    updates: ["Has 12 hours of bandwidth this sprint"],
  },
  {
    id: "sourav",
    name: "Sourav Das",
    role: "Engineer",
    team: "Conversational AI",
    initials: "SD",
    utilisation: 58,
    bandwidthHours: 18,
    hoursLogged: 39,
    estimatedHours: 44,
    velocity: 5,
    estimateAccuracy: 76,
    estimateCoverage: 72,
    worklogs: 9,
    commentCount: 6,
    idleDays: 2,
    darkWip: 2,
    health: "Needs Attention",
    riskFlags: ["Low estimate coverage", "2 idle days"],
    allocations: [{ projectId: "cx", pct: 58, hours: 39 }],
    current: [t("CX-776", "Agent performance endpoint", "cx", "In Progress", "Medium", 14, 5, "2d ago")],
    upcoming: [t("CX-822", "Proration rules support", "cx", "To Do", "Low", null, 0, "—")],
    completed: [t("CX-540", "Transcription batching", "cx", "Done", "Medium", 12, 14, "10d ago")],
    comments: [{ ticket: "CX-776", text: "Schema still in flux, holding off on the query layer.", when: "2d ago" }],
    timeline: [
      { when: "2 days ago", text: "Last worklog recorded" },
      { when: "5 days ago", text: "Picked up agent performance endpoint" },
    ],
    updates: ["18 hours of available bandwidth", "Needs estimates added to queued work"],
  },
  {
    id: "marta",
    name: "Marta Silva",
    role: "Tech Lead",
    team: "Data Platform",
    initials: "MS",
    utilisation: 95,
    bandwidthHours: 2,
    hoursLogged: 71,
    estimatedHours: 70,
    velocity: 8,
    estimateAccuracy: 96,
    estimateCoverage: 98,
    worklogs: 20,
    commentCount: 27,
    idleDays: 0,
    darkWip: 0,
    health: "On Track",
    riskFlags: [],
    allocations: [
      { projectId: "atlas", pct: 68, hours: 48 },
      { projectId: "cx", pct: 27, hours: 23 },
    ],
    current: [
      t("AT-221", "Backfill conversation fact tables", "atlas", "In Progress", "Critical", 30, 24, "1h ago"),
      t("CX-830", "Reply ranking model integration", "cx", "In Progress", "High", 28, 12, "5h ago"),
    ],
    upcoming: [t("AT-229", "Cutover runbook", "atlas", "To Do", "High", 8, 0, "—")],
    completed: [t("AT-196", "Report embedding auth", "atlas", "Done", "High", 14, 13, "9d ago")],
    comments: [{ ticket: "AT-221", text: "Backfill at 80%, expecting completion Thursday.", when: "1h ago" }],
    timeline: [
      { when: "Today", text: "Backfill reached 80% of historical rows" },
      { when: "Yesterday", text: "Reviewed dual-write validation harness" },
    ],
    updates: ["Best estimate accuracy on the team", "Owns Atlas Analytics"],
  },
  {
    id: "diego",
    name: "Diego Alvarez",
    role: "Senior Engineer",
    team: "Platform",
    initials: "DA",
    utilisation: 88,
    bandwidthHours: 5,
    hoursLogged: 63,
    estimatedHours: 66,
    velocity: 7,
    estimateAccuracy: 89,
    estimateCoverage: 92,
    worklogs: 17,
    commentCount: 15,
    idleDays: 0,
    darkWip: 0,
    health: "On Track",
    riskFlags: [],
    allocations: [
      { projectId: "vault", pct: 60, hours: 40 },
      { projectId: "atlas", pct: 28, hours: 23 },
    ],
    current: [
      t("VA-140", "SCIM user lifecycle endpoints", "vault", "In Progress", "High", 26, 18, "2h ago"),
      t("AT-250", "Materialised view refresh scheduling", "atlas", "In Progress", "Medium", 16, 9, "1d ago"),
    ],
    upcoming: [t("AT-244", "Dashboard sharing permissions", "atlas", "To Do", "Medium", 14, 0, "—")],
    completed: [t("VA-84", "Permission set editor", "vault", "Done", "High", 20, 19, "12d ago")],
    comments: [{ ticket: "VA-140", text: "Deactivate path done, working through group sync.", when: "2h ago" }],
    timeline: [
      { when: "Today", text: "SCIM deactivate flow completed" },
      { when: "Yesterday", text: "Reviewed Atlas refresh scheduling design" },
    ],
    updates: ["Owns Vault Security"],
  },
  {
    id: "nadia",
    name: "Nadia Haddad",
    role: "Engineer",
    team: "Data Platform",
    initials: "NH",
    utilisation: 64,
    bandwidthHours: 15,
    hoursLogged: 43,
    estimatedHours: 48,
    velocity: 6,
    estimateAccuracy: 85,
    estimateCoverage: 90,
    worklogs: 13,
    commentCount: 10,
    idleDays: 0,
    darkWip: 1,
    health: "On Track",
    riskFlags: [],
    allocations: [
      { projectId: "atlas", pct: 46, hours: 30 },
      { projectId: "vault", pct: 18, hours: 13 },
    ],
    current: [
      t("AT-240", "Tile configuration schema", "atlas", "In Progress", "High", 22, 13, "4h ago"),
      t("VA-150", "Event schema versioning", "vault", "In Progress", "Medium", 16, 7, "1d ago"),
    ],
    upcoming: [t("AT-253", "Result cache for shared dashboards", "atlas", "Blocked", "Medium", 12, 0, "6d ago")],
    completed: [t("AT-161", "Sheets export destination", "atlas", "Done", "Medium", 10, 9, "14d ago")],
    comments: [{ ticket: "AT-253", text: "Blocked on infra capacity approval, no ETA yet.", when: "2d ago" }],
    timeline: [
      { when: "Today", text: "Tile configuration schema draft shared" },
      { when: "2 days ago", text: "Raised infra capacity request" },
    ],
    updates: ["15 hours of available bandwidth"],
  },
  {
    id: "tomas",
    name: "Tomas Berg",
    role: "Engineer",
    team: "Growth",
    initials: "TB",
    utilisation: 112,
    bandwidthHours: -7,
    hoursLogged: 81,
    estimatedHours: 68,
    velocity: 5,
    estimateAccuracy: 71,
    estimateCoverage: 66,
    worklogs: 19,
    commentCount: 7,
    idleDays: 0,
    darkWip: 4,
    health: "At Risk",
    riskFlags: ["Overallocated", "Blocked 18 days on OR-91", "Dark WIP on 4 tickets"],
    allocations: [
      { projectId: "orbit", pct: 82, hours: 58 },
      { projectId: "vault", pct: 30, hours: 23 },
    ],
    current: [
      t("OR-91", "Channel connect steps", "orbit", "Blocked", "Critical", 18, 11, "18d ago"),
      t("VA-144", "Group to role mapping", "vault", "In Review", "High", 14, 13, "3h ago"),
    ],
    upcoming: [t("OR-95", "Progress persistence", "orbit", "To Do", "Medium", 10, 0, "—")],
    completed: [t("OR-36", "Workspace provisioning worker", "orbit", "Done", "High", 20, 26, "18d ago")],
    comments: [{ ticket: "OR-91", text: "Still waiting on Platform for the shared OAuth service.", when: "3d ago" }],
    timeline: [
      { when: "Today", text: "Group to role mapping ready for review" },
      { when: "3 days ago", text: "Re-escalated OR-91 blocker" },
    ],
    updates: ["Overallocated across Orbit and Vault", "Longest running blocker in the org"],
  },
  {
    id: "priya",
    name: "Priya Menon",
    role: "Engineer",
    team: "Growth",
    initials: "PM",
    utilisation: 76,
    bandwidthHours: 9,
    hoursLogged: 52,
    estimatedHours: 58,
    velocity: 6,
    estimateAccuracy: 80,
    estimateCoverage: 74,
    worklogs: 14,
    commentCount: 12,
    idleDays: 0,
    darkWip: 2,
    health: "Needs Attention",
    riskFlags: ["Estimate coverage below 80%"],
    allocations: [{ projectId: "orbit", pct: 76, hours: 52 }],
    current: [t("OR-102", "CSV contact importer", "orbit", "In Progress", "High", 20, 14, "2h ago")],
    upcoming: [t("OR-106", "Zendesk conversation mapping", "orbit", "To Do", "High", 26, 0, "—")],
    completed: [t("OR-52", "Seed data generator", "orbit", "Done", "Medium", 12, 11, "16d ago")],
    comments: [{ ticket: "OR-102", text: "First full import ran clean on a 20k contact file.", when: "2h ago" }],
    timeline: [
      { when: "Today", text: "CSV importer completed an end-to-end run" },
      { when: "Yesterday", text: "Asked product for import volume limits" },
    ],
    updates: ["Waiting on product decision for import limits"],
  },
];

export const teams = ["Platform", "Conversational AI", "Data Platform", "Growth"] as const;

export const overviewReasons = [
  "Sophie Laurent has exceeded planned capacity for a second sprint",
  "CX Messaging has three open blockers, one at critical priority",
  "Board health dropped 6 points this week on estimate coverage",
];

export const recentActivity: {
  when: string;
  text: string;
  kind: "released" | "completed" | "blocked" | "qa" | "merged" | "update";
  projectId: string;
}[] = [
  { when: "Today · 09:40", text: "Workflow Builder 2.1 released to all workspaces", kind: "released", projectId: "cx" },
  { when: "Today · 08:15", text: "Billing Configuration entered QA", kind: "qa", projectId: "cx" },
  { when: "Today · 07:50", text: "Group to role mapping opened for review", kind: "update", projectId: "vault" },
  { when: "Yesterday · 17:20", text: "Speech Recognition improvements merged to main", kind: "merged", projectId: "cx" },
  { when: "Yesterday · 15:05", text: "Knowledge Base URL Import completed", kind: "completed", projectId: "cx" },
  { when: "Yesterday · 11:30", text: "OR-91 escalated to Platform — blocked 18 days", kind: "blocked", projectId: "orbit" },
  { when: "2 days ago", text: "Embedded Report Viewer released to pilot accounts", kind: "released", projectId: "atlas" },
  { when: "2 days ago", text: "CX-770 blocked by Data Platform schema migration", kind: "blocked", projectId: "cx" },
  { when: "3 days ago", text: "Session Policies rolled out to enterprise tier", kind: "released", projectId: "vault" },
];

export const standouts = [
  { title: "Highest Delivery", personId: "marta", detail: "8 capabilities contributed across two projects this quarter" },
  { title: "Best Estimate Accuracy", personId: "marta", detail: "96% accuracy across 20 estimated tickets" },
  { title: "Cleanest Jira", personId: "ashish", detail: "96% estimate coverage, zero stale tickets, 24 comments" },
  { title: "Most Tickets Closed", personId: "shreya", detail: "14 tickets closed in the last two sprints" },
  { title: "Best Sprint Consistency", personId: "diego", detail: "Delivered within ±5% of commitment for 6 sprints" },
];

/* ---------- derived helpers ---------- */

export const projectById = (id: string) => projects.find((p) => p.id === id)!;
export const personById = (id: string) => people.find((p) => p.id === id)!;

export const contributorsOf = (projectId: string) =>
  people
    .filter((p) => p.allocations.some((a) => a.projectId === projectId))
    .map((p) => {
      const a = p.allocations.find((x) => x.projectId === projectId)!;
      return { person: p, pct: a.pct, hours: a.hours };
    })
    .sort((x, y) => y.pct - x.pct);

export const ownershipOf = (projectId: string) => {
  const c = contributorsOf(projectId);
  const total = c.reduce((s, x) => s + x.pct, 0) || 1;
  return c.map((x) => ({ ...x, share: Math.round((x.pct / total) * 100) }));
};

export const teamStats = (team: string) => {
  const members = people.filter((p) => p.team === team);
  const avgUtil = Math.round(members.reduce((s, p) => s + p.utilisation, 0) / members.length);
  const avgBandwidth = Math.round(members.reduce((s, p) => s + p.bandwidthHours, 0) / members.length);
  const risk: Health = members.some((p) => p.health === "At Risk")
    ? "At Risk"
    : members.some((p) => p.health === "Needs Attention")
      ? "Needs Attention"
      : "On Track";
  return { members, avgUtil, avgBandwidth, headcount: members.length, risk };
};

export const orgMetrics = (() => {
  const avgUtil = Math.round(people.reduce((s, p) => s + p.utilisation, 0) / people.length);
  const availableHours = people.reduce((s, p) => s + Math.max(0, p.bandwidthHours), 0);
  const overallocated = people.filter((p) => p.utilisation > 100);
  const atRiskProjects = projects.filter((p) => p.health !== "On Track");
  const estimateCoverage = Math.round(people.reduce((s, p) => s + p.estimateCoverage, 0) / people.length);
  const blocked = projects.reduce((s, p) => s + p.risks.blockers.length, 0);
  const darkWip = people.reduce((s, p) => s + p.darkWip, 0);
  const closedWithoutLogs = 7;
  const boardHealth = Math.round(
    estimateCoverage * 0.5 + (100 - Math.min(100, blocked * 6)) * 0.25 + (100 - Math.min(100, darkWip * 4)) * 0.25,
  );
  return {
    avgUtil,
    availableHours,
    overallocated,
    atRiskProjects,
    estimateCoverage,
    blocked,
    darkWip,
    closedWithoutLogs,
    boardHealth,
    activeProjects: projects.length,
  };
})();

export const allBlockers = projects.flatMap((p) =>
  p.risks.blockers.map((b) => ({ ...b, projectId: p.id, projectName: p.name, lastUpdated: `${Math.max(1, Math.floor(b.days / 3))}d ago` })),
);