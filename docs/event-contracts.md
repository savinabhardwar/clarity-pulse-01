# event-contracts.md — Normalized internal event schema

Per `IMPLEMENTATION_PLAN.md` task 0.6 and `CLAUDE.md` §4 (`packages/core`).
Defines the one internal event shape every ingest Worker normalizes into.

---

## Normalized event shape

| Field                         | Type | Notes |
| ----------------------------- | ---- | ----- |
| `source`                      |      |       |
| `event_type`                  |      |       |
| `project_id`                  |      |       |
| `entity_type`                 |      |       |
| `entity_id`                   |      |       |
| `actor`                       |      |       |
| `timestamp`                   |      |       |
| `payload`                     |      |       |
| `correlation_id`              |      |       |
| provider event ID (dedup key) |      |       |

---

## Jira

### Event types emitted

**Unverified — no webhook subscription found in this repo or confirmed in
Jira admin.** Everything reading Jira today (`fetch-jira-rest.mjs`,
`find-jira-match.ts`) polls `/rest/api/3/search/jql` on a schedule; nothing
in this codebase proves Jira webhooks are configured or even reachable from
this environment. `CLAUDE.md`'s target architecture (Cloudflare Workers
webhook ingestion) is not yet validated against what this Jira site
actually supports/has enabled — needs direct verification in Jira admin
(System → WebHooks), not something inferable from existing code.

**Update 2026-09-22 — unrelated to this doc's ingestion design:** a Jira
webhook subscription now exists (System → WebHooks), but it feeds
`project-compass/src/routes/api.jira-webhook.ts` directly — a narrow,
one-way sync of `jira:issue_updated` status back onto linked
`stakeholder_items` rows in project-compass's own Supabase project. It is
NOT the Cloudflare Workers ingestion pipeline this doc otherwise describes,
does not write to the `ai-pm-platform` event tables, and should not be
treated as validating that a general-purpose webhook is available for
task 3.x ingestion — confirm that separately. The payload shape it assumes
(`issue.key`, `issue.fields.status.name`) is Atlassian's documented
`jira:issue_updated` shape but has not yet been checked against a real
captured delivery; verify on first live webhook call and update this note.

### Dedup key

If polling remains the ingestion mode: `issue.id` + `fields.updated`
(an issue's own change timestamp) is a workable dedup/ordering key — Jira
issue IDs are stable and `updated` strictly increases per edit, per the
existing pipeline's own reasoning in `fetch-jira-rest.mjs` (cursors
`fetchHistory` on `updated`, explicitly not on `resolutiondate`, because the
latter is frequently null on exactly the tickets that need catching).
If webhooks are confirmed later: Jira's webhook payload's own
`webhookEvent` + `timestamp` + issue id is the equivalent key — needs a real
captured payload to confirm the field names.

### Ordering guarantees (or lack thereof)

None from polling — a full poll returns current state, not an ordered
event stream. Building a normalized `events` row per polled change requires
diffing against last-seen state per issue, not trusting delivery order (there
is no delivery). This is a materially different implementation from what
task 3.4's "replay and shuffle" test assumes for a true webhook stream —
worth flagging as a design fork depending on the webhook-availability answer
above.

---

## Requirements Gathering App (project-compass)

### Event types emitted

**None — confirmed.** No webhook, trigger-to-external-call, or queue exists
in `project-compass`. The only state changes are Postgres row
inserts/updates via its own RPC functions
(`stakeholder_items_create/_update/_create_request/_assign_project`,
`stakeholder_item_comments_add`), all going to its own separate Supabase
project. Ingestion here can only be **polling `stakeholder_items` (and
`stakeholder_item_comments` for clarification events) via its Supabase REST
API**, using the anon key + whatever RLS currently allows reads, or via a
Postgres change-data-capture approach if project-compass's owner grants
deeper access later (not currently available).

### Dedup key

`stakeholder_items.id` (uuid, stable) + `updated_at`. The append-only
`stakeholder_item_history` table (trigger-populated, immutable) is a better
source for true event-level dedup than diffing `stakeholder_items` snapshots
— each history row already has `event_type`, `field_name`, `old_value`,
`new_value`, `changed_at`, which maps closely to the internal event shape.
Recommend polling `stakeholder_item_history` by `changed_at`, not
`stakeholder_items` by `updated_at`, once we have read access — record this
as a design note for task 3.1, not yet a decision.

### Ordering guarantees (or lack thereof)

`stakeholder_item_history.changed_at` is set by `now()` at write time in a
single Postgres trigger transaction — reliable ordering within that table if
polled by `changed_at` ascending with a safety overlap window.

---

## Git provider

### Event types emitted

### Dedup key

### Ordering guarantees (or lack thereof)

---

## QA source

### Event types emitted

### Dedup key

### Ordering guarantees (or lack thereof)

---

## Internal event vocabulary (from spec §8, to be reconciled against real payloads)

See `docs/spec.md` §8 for the spec's initial event vocabulary by source. This
section records how that vocabulary maps to what the real systems actually
emit, once 0.2–0.4 are done.
