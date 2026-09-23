import type { NormalizedEvent } from "../event.ts";

// project-compass's stakeholder_items shape -- re-verified live 2026-09-23
// against the real table (a stale field-mapping.md claim, jira_url/jira_key
// as scalar columns, was caught and corrected this session: migration 0008
// moved them to a separate stakeholder_item_jira_links table, one-to-many,
// months before this check). Only the fields this normalizer reads are
// typed. See docs/field-mapping.md.
export interface StakeholderItem {
  id: string;
  project_id: string | null; // nullable: multi-candidate "decision" items have no project yet (docs/discovery.md §0.3)
  summary: string;
  status: string;
  created_by: string | null;
  updated_at: string;
}

// Same "poll snapshot, don't infer what changed" shape as the Jira
// normalizer, for the same reason: project-compass emits no
// webhook/event of its own (docs/event-contracts.md, confirmed --
// "None -- confirmed"), so this is a polled row, not a delivered event.
//
// Dedup key: stakeholder_items.id + updated_at, per
// docs/event-contracts.md's documented reasoning. (That doc recommends
// polling stakeholder_item_history instead, once read access exists --
// not available yet, so this normalizer works against the row shape we
// can actually reach today.)
//
// projectHint is project-compass's OWN project_id (its internal uuid,
// not a Jira key) -- resolves via projects.requirements_project_id
// (migration 0001), not projects.jira_project_key. An item with no
// project_id yet (a multi-candidate "decision") has nothing to resolve
// against and the ingest Worker should record-and-drop it, same as any
// unconfigured-project event (D24) -- not this function's job to decide.
export function normalizeStakeholderItem(item: StakeholderItem): NormalizedEvent | null {
  if (item.project_id === null) return null;
  return {
    source: "requirements-app",
    eventType: "requirement.observed",
    projectHint: item.project_id,
    entityType: "requirement",
    entityId: item.id,
    actor: item.created_by ? { type: "user", id: item.created_by } : null,
    timestamp: item.updated_at,
    payload: item,
    correlationId: null,
    providerEventId: `${item.id}:${item.updated_at}`,
  };
}
