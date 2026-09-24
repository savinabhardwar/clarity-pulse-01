// Pure types/constants for the Stakeholder Management Dashboard.
// Replaces the in-memory prototype's stakeholder-store.ts -- data itself now
// lives in Supabase (see src/data/queries.ts); this file keeps only the shape
// definitions and the fixed option lists the UI needs.

export type ItemKind = "feature" | "implementation";

// Which group a status value belongs to. Set EXPLICITLY by the user (via a
// segmented control choosing which list to pick from), never inferred from
// the string itself -- the prototype's statusKindOf() inferred this from
// list membership and was silently wrong for "To Do"/"In Progress"/"Done",
// which exist in both lists and always resolved to "jira".
export type StatusKind = "stakeholder" | "jira";

export const STAKEHOLDER_STATUSES = [
  "To Do",
  "In Progress",
  "Waiting for Spec",
  "Waiting for confirmation",
  "Clarification Needed",
  "Deprioritised",
  "Reviewing Requirements",
  "Done",
] as const;

// Set automatically -- never picked directly in the item form -- whenever a
// "Clarification Needed" comment is posted on an item (see
// stakeholder_item_comments_add). Items in this status are surfaced at the
// top of the Client Requests module.
export const CLARIFICATION_NEEDED_STATUS = "Clarification Needed";

// The full, exact set of statuses in use across the org's Jira instance
// (confirmed live via GET /rest/api/3/status on 2026-09-10) -- NOT a
// generic 4-value bucket. An earlier version of this list only had
// "To Do"/"In Progress"/"In Review"/"Done" and mapped every real status
// onto the nearest of those (e.g. "Testing" -> "In Progress"), which
// silently lost real information: a ticket actually in Jira's "Testing"
// status displayed as "In Progress" on the board, indistinguishable from
// tickets genuinely still being worked. Keep this in sync with Jira if the
// org's workflow ever adds/renames a status -- a status that comes back
// from the Jira API but isn't in this list still gets stored and displayed
// correctly everywhere except the form's Status <Select>, which can only
// offer options from this list.
export const JIRA_STATUSES = [
  "To Do",
  "In Progress",
  "Code Review",
  "In Review",
  "Review",
  "Testing",
  "Blocked",
  "Dependent",
  "Idea",
  "Deprioritised",
  "Done",
  "Cant Do",
  "CAN'T DO",
  "Not Succesfull",
  "NOT SUCCESSFUL",
] as const;

export type Priority = "High" | "Medium" | "Low";
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
// Lower rank = higher priority, for sort comparisons (High before Medium before Low).
export const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

// The 4 request types offered by the Client Requests module. The first 3
// route the item to a project's Features tab (kind "feature"); the 4th
// routes to that project's Client Requests tab (kind "implementation").
// `request_type` is null for items created directly in a project (not
// through the Client Requests module) -- those don't appear in the module.
export type RequestType =
  "product_enhancement" | "product_bug" | "new_request" | "client_onboarding";

export const REQUEST_TYPES: { value: RequestType; label: string; kind: ItemKind }[] = [
  { value: "product_enhancement", label: "Product Enhancement", kind: "feature" },
  { value: "product_bug", label: "Product Bug", kind: "feature" },
  { value: "new_request", label: "New Request", kind: "feature" },
  { value: "client_onboarding", label: "Client Onboarding onto Platform", kind: "implementation" },
];

export function requestTypeLabel(type: RequestType | null): string {
  return REQUEST_TYPES.find((r) => r.value === type)?.label ?? "—";
}

export function kindForRequestType(type: RequestType): ItemKind {
  return REQUEST_TYPES.find((r) => r.value === type)!.kind;
}

// The 2 options offered when posting a comment on a Features-tab item.
// "clarification" flips the whole item's status to Clarification Needed
// (see stakeholder_item_comments_add); "updates" just posts the comment.
export type CommentType = "clarification" | "updates";
export const COMMENT_TYPES: { value: CommentType; label: string }[] = [
  { value: "clarification", label: "Clarification Needed" },
  { value: "updates", label: "Updates" },
];

export type Attachment = {
  id: string;
  itemId: string;
  storagePath: string;
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
};

export type HistoryEntry = {
  id: string;
  eventType: "created" | "updated" | "deleted";
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
};

export type Comment = {
  id: string;
  itemId: string;
  authorName: string;
  authorEmail: string;
  body: string;
  commentType: CommentType;
  createdAt: string;
};

export type RecentActivityEntry = {
  id: string;
  itemId: string | null;
  itemSummary: string | null;
  kind: ItemKind | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  eventType: "created" | "updated" | "deleted";
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
};

export type JiraLink = {
  id: string;
  itemId: string;
  jiraKey: string;
  jiraUrl: string;
  addedBy: string;
  createdAt: string;
};

export type StakeholderItem = {
  id: string;
  projectId: string;
  kind: ItemKind;
  requestType: RequestType | null;
  summary: string;
  description: string;
  status: string;
  statusKind: StatusKind;
  priority: Priority;
  createdBy: string;
  requiredBy: string | null; // yyyy-mm-dd
  willBeDoneBy: string | null; // yyyy-mm-dd
  createdAt: string; // Date Added -- set once at creation, never changed by edits
  updatedAt: string;
};

export type ItemDraft = Omit<
  StakeholderItem,
  "id" | "createdAt" | "updatedAt" | "projectId" | "kind"
>;

// One row of the global Client Requests module -- every item across every
// project that was created with a request_type, i.e. through that module.
export type ClientRequest = Omit<StakeholderItem, "projectId"> & {
  // Null for a Features-tab item surfaced here only because it's in
  // Clarification Needed status, not because it was created through the
  // Client Requests intake module (see stakeholder_client_requests view).
  requestType: RequestType | null;
  // Null exactly when isDecision is true -- a request created with 2+
  // candidate projects has no destination project yet.
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  // True when this request was created with multiple candidate projects and
  // nobody has picked its one destination project yet (see
  // stakeholder_items_assign_project). Such a request never appears in any
  // project's module, only here, until it's resolved.
  isDecision: boolean;
  candidateProjects: { id: string; name: string }[];
};

export type Project = {
  id: string;
  name: string;
  code: string;
  jiraProjectKey: string | null;
  owner: string;
  description: string;
};

// No login exists anywhere in this monorepo -- identity here is
// self-declared (name + email, entered once via identity-gate.tsx) and
// stored client-side, not verified. Anyone can type any name; this is an
// attribution convenience, not a security boundary, same trust level every
// other app in this org already operates at.
export type Identity = { name: string; email: string };
const IDENTITY_KEY = "stakeholder-identity";

export function getIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === "string" && typeof parsed?.email === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function setIdentity(identity: Identity) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // ignore -- private browsing / storage blocked; the gate will just re-prompt next load
  }
}

export function clearIdentity() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // ignore
  }
}

export function isValidEmail(s: string): boolean {
  return /\S+@\S+\.\S+/.test(s.trim());
}

// Derives a Jira key from a pasted ticket URL (e.g. ".../browse/CP-40" -> "CP-40")
// for manual entry -- falls back to treating the whole trimmed input as the key
// if it doesn't look like a URL.
export function deriveJiraKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const fromUrl = trimmed.split("/").filter(Boolean).pop();
  return fromUrl ?? trimmed;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB, matches the storage bucket's file_size_limit
const DENYLISTED_EXTENSIONS = ["exe", "bat", "sh", "cmd", "msi", "com", "scr"];

export function validateAttachment(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is larger than 20 MB.`;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (DENYLISTED_EXTENSIONS.includes(ext)) {
    return `${file.name} has a disallowed file type.`;
  }
  return null;
}
