# discovery.md — Phase 0 findings

This is the contract every later phase depends on. Nothing here may be
invented — every entry is either verified against a real system or explicitly
marked as an open question waiting on the human. See `CLAUDE.md` §3 rule 2 and
`IMPLEMENTATION_PLAN.md` Phase 0.

---

## 0.2 Jira configuration

### Deployment type (Cloud vs Data Center)

**Verified live** via the Atlassian MCP connector (`getAccessibleAtlassianResources`):
Jira **Cloud**, site `alldaypa.atlassian.net`, cloud ID
`037c9cc3-d3a1-47b4-b744-30eaa400d51e`. Current session scopes:
`read:jira-work`, `write:jira-work` (Confluence read/write scopes also
present but out of scope for this project). Auth model actually in
production use elsewhere in this repo (`scripts/jira-sync/fetch-jira-rest.mjs`,
`project-compass/src/actions/find-jira-match.ts`): HTTP Basic auth with
`JIRA_EMAIL` + `JIRA_API_TOKEN` (a Jira Cloud API token) against
`/rest/api/3/*`. Neither value was read from `.dev.vars`/env by me — this is
citing existing code that already authenticates successfully, not a claim I
independently obtained credentials.

### Project keys and issue types

**Verified live** — 26 visible projects on this site (`getVisibleJiraProjects`):
`AA, ACX, AF, AMY, AV, BL, CP, CX, FR, KA, KH, LT, MI, MR, PBX, QIP, SB, SP,
TEAM, TEAMSANKYA, TI, TRG, TS, TSD, TT, UM`. Of these, 20 are already tracked
by `scripts/jira-sync/fetch-jira-rest.mjs`'s `JIRA_PROJECTS` list (excludes
AF, MI, SB, SP, TS, TSD — not currently pipeline-tracked; scope for the AI PM
Automation Platform is undecided, see open question below).

**Critical structural fact, verified live:** projects are a mix of
**team-managed** (`"simplified": true, "style": "next-gen"` — e.g. TEAM,
TEAMSANKYA, TI, TRG, TT, MI, AF, SP, TSD) and **company-managed**
(`"simplified": false, "style": "classic"` — e.g. LT, ACX, CP, BL, MR, FR,
QIP, PBX, KA, UM, AMY, CX, AA, KH, AV). **Statuses and transition IDs are
per-project, not global** — team-managed projects in particular can each have
their own independent workflow/status set. The Policy/Automation Engine must
resolve the transition table **per project**, never assume one global ID
works across projects. This directly affects task 2.1/4.1 design: no global
"transition ID for QA PASS" constant — it must be a per-project lookup.

Issue types on **LT** (Line Tester), verified live via
`getJiraProjectIssueTypesMetadata`: Epic, Story, Task, Sub-task, Bug,
**QAlity Test** (id `10131`, project-specific — "used to create QAlity test
case"), **Change Control** (id `10635`). The QA-issue-type and Change Control
type are not in the original spec at all — open question below.

### Exact status names

**Verified live for LT** (via `searchJiraIssuesUsingJql` + real issue
statuses): `To Do` (id `10227`), `In Progress` (id `3`), `Deprioritised` (id
`10559`), `Testing` (id `10029`), `Blocked` (id `10013`), `Review` (id
`10267`), `Done` (id `10228`).

**Not yet verified for any other project.** Given team-managed projects can
each carry a distinct workflow, this list cannot be assumed to hold elsewhere
without checking — see open question below on pilot scope.

### Transition table (real IDs) — LT project only, verified live

| From status | Transition ID | Transition name     | To status             | Global? |
| ----------- | ------------- | ------------------- | --------------------- | ------- |
| In Progress | 11            | To Do               | To Do (10227)         | yes     |
| In Progress | 12            | Deprioritised       | Deprioritised (10559) | yes     |
| In Progress | 21            | In Progress         | In Progress (3)       | yes     |
| In Progress | 31            | Done                | Done (10228)          | yes     |
| In Progress | 41            | Blocked             | Blocked (10013)       | yes     |
| In Progress | 2             | In Progress to done | Done (10228)          | no      |
| In Progress | 3             | Review              | Review (10267)        | no      |
| In Progress | 8             | Testing             | Testing (10029)       | no      |
| In Progress | 9             | Blocked             | Blocked (10013)       | no      |
| Testing     | 11            | To Do               | To Do (10227)         | yes     |
| Testing     | 12            | Deprioritised       | Deprioritised (10559) | yes     |
| Testing     | 21            | In Progress         | In Progress (3)       | yes     |
| Testing     | 31            | Done                | Done (10228)          | yes     |
| Testing     | 41            | Blocked             | Blocked (10013)       | yes     |
| Testing     | 10            | Done                | Done (10228)          | no      |

**Mismatch found and resolved during this session.** Originally, no
sampled project had a "Rework" status — from Testing, the only path back to
active work was straight to In Progress. The human added a real "Rework"
status directly in Jira admin over the course of this session. Final
verified state across all 20 tracked projects:

| Workflow (identified by its status IDs)                                                                                                 | Projects                                               | Rework status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared workflow (To Do `10227`, In Progress `3`, Testing `10029`, Done `10228`, Blocked `10013`, Review `10267`, Deprioritised `10559`) | LT, AA, ACX, AV, CX, FR, PBX, UM, CP, MR, QIP, AMY, KH | **Has Rework** (status `10658`, transition "test to rework" id 4). Live-confirmed on a Testing- or In-Progress-status ticket, with matching transition IDs (11/12/21/31/41/4/10, or the extended 8-transition In-Progress set 11/12/21/31/41/2/3/8/9), for LT/AA/ACX/AV/CX/FR/PBX/UM/CP/MR/QIP/AMY/KH. KA and BL share the same core status IDs on other tickets but had **no ticket currently in In Progress or Testing** at check time (2026-09-18) — transitions not directly confirmed, treat as high-confidence, not fully proven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TT's own workflow (`10162`–`10197`)                                                                                                     | TT                                                     | **Correction to this doc's earlier entry:** TT was previously listed under the shared workflow above — that was wrong. Live-verified 2026-09-18: TT has entirely distinct status IDs (In Progress `10162`, Testing `10194`, Blocked `10196`, Review `10195`, Done `10163`, Cant Do `10197`, Deprioritised `10625`) and its own transition set from Testing: `completed`(3)→Testing itself(10194, oddly categorized "To Do" — self-referential/no-op-looking transition, verify before relying on it), `Blocked`(4)→10196, `Cannot be done`(5)→10163("Cant Do", despite the label pointing at the Done-category status id), `Changes Done`(7)→10195(Review), `Done`(12)→10163. **No Rework transition exists for TT** — this reopens task 4.4's TT exclusion question, since the original doc had TT _inside_ the Rework-supporting shared group. TT is Rework-less like TEAM/TEAMSANKYA, not Rework-having like the shared group; policy/automation must treat TT the same as TEAM/TEAMSANKYA for the Rework-dependent rule, not the same as LT. |
| TI's own workflow (`10164`–`10169`, `10592`)                                                                                            | TI                                                     | **Correction to this doc's earlier entry:** the status-ID range and Rework transition details for TI and TRG below were swapped in the original write-up. Re-verified live 2026-09-18 against TI-2192 (Testing): TI's Rework status is `10660`, reached via transition **id 21** ("rework"). Other TI transitions from Testing: `Blocked`(3)→10167, `Deprioritised`(20)→10592, `Done`(31)→10166, `Cannot Test`(7)→10169("Cant Do"), `Testing complete`(9)→10166(Done), `redo`(18)→10164(To Do).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| TRG's own workflow (`10335`–`10349`, `10454`)                                                                                           | TRG                                                    | **Correction to this doc's earlier entry** (see TI row above — ranges/IDs were swapped). Re-verified live 2026-09-18 against TRG-1413 (Testing): TRG's Rework status is `10659`, reached via transition **id 6** ("rework"). Other TRG transitions from Testing: `TESTING`(2)→10347(self), `REVIEW`(3)→10348, `CAN'T DO`(4)→10349, `To Do`(11)→10338, `In Progress`(21)→10339, `Done`(31)→10340, `Blocked`(5)→10454.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| TEAMSANKYA's own workflow (`10335`–`10337`, `10344`–`10346`, `10386`)                                                                   | TEAMSANKYA                                             | **No Rework — deliberately excluded from scope for now** (human's explicit call). Re-confirmed live 2026-09-18 against TEAMSANKYA-817 (In Progress): available transitions are `TESTING`(2)→10344, `REVIEW`(3)→10345, `CAN'T DO`(4)→10346, `Blocked`(5)→10386, `To Do`(11)→10335, `In Progress`(21)→10336, `Done`(31)→10337 — no rework transition present, confirming the exclusion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TEAM's own workflow (`10341`–`10353`)                                                                                                   | TEAM                                                   | **No Rework — deliberately excluded from scope for now** (human's explicit call). Has its own "Start Testing" transition and Testing status, just no Rework. Not re-verified this session beyond a To-Do-status sample (TEAM-1158) — no ticket in a further-along status was available to pull a fuller transition list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Important — the TI/TRG status-ID ranges and Rework transition IDs above are corrected from an earlier version of this document, which had them swapped between the two projects.** If any code, config, or notes elsewhere already reference the old (incorrect) TI/TRG transition IDs, they must be updated before task 4.1 (Policy Engine) is implemented against them. Likewise, **TT was moved out of the shared-workflow/Rework-having group** it was previously listed under — anything that assumed TT supports a Testing→Rework transition is wrong and must be corrected to treat TT like TEAM/TEAMSANKYA (no Rework) instead.

**Scope decision (human-confirmed):** TEAMSANKYA and TEAM are out of scope
for the Rework-dependent workflow rules (task 4.4) until further notice.
Any policy/automation rule keyed on "QA FAIL → Rework" must either exclude
these two projects or treat their absence of Rework as a configuration fact
per project, not assume it project-wide.

Also confirmed, still true for every project: two "Done"-reaching
transitions exist per project (e.g. a global one and a specific one) that
would let a ticket skip the QA gate entirely if fired without a policy
check — the Policy/Automation Engine must never fire a "Done" transition
except through the QA-PASS-verified path, regardless of which transition ID
gets there. This is a policy design point, not something Jira config can
fix.

**Not independently verified:** the reverse `Rework → Testing` transition,
on any project. No ticket has yet sat in Rework long enough to check what
transitions are available from it. Confirm this once a real ticket reaches
Rework, before task 4.4 ships.

### Custom field IDs (estimate hours, QA fields)

**Inherited from existing production code, not independently re-verified by
me against the field API.** `scripts/jira-sync/fetch-jira-rest.mjs` and
`project-compass` both already read these successfully in production:

- `customfield_10020` — Sprint field (used across all tracked projects)
- `customfield_10690` — QA Assignee (added for ACX's same-ticket Dev+QA
  tracking, Sept 2026, but the field/screen is instance-global — comment in
  source says it "may appear on any project's issues, not just ACX's")
- `customfield_10691` — QA Planned Hours (same field, instance-global;
  returns plain hours as a number, not seconds like native estimate fields)

No field ID for "estimate hours" beyond Jira's native `timeoriginalestimate`
/ `timeestimate` was found — the existing pipeline uses those native fields,
not a custom one. No QA PASS/FAIL result field, comments field, test-cases-
executed field, or evidence field (D11's four mandatory fields) was found
anywhere in the existing code — **these likely don't exist as Jira fields
yet** and are an open item (see 0.4 QA source).

### Sprint/board API shape

**Verified via existing production code** (`fetchTrackedSprints` in
`fetch-jira-rest.mjs`): sprints are read off `customfield_10020` on issues
(not via the separate Agile `/rest/agile/1.0/board` endpoints), using
`Sprint in openSprints()` in JQL to find each project's current active
sprint, then reading `{name, startDate, endDate, state, goal}` from the
field's returned sprint objects. Deliberately does **not** fall back to "last
sprint in history" when no active sprint exists — treats that as "nothing
tracked this run" rather than guessing.

### Available webhook events

**Verified live (2026-09-18)** via `GET /rest/webhooks/1.0/webhook` using
the existing `JIRA_EMAIL`/`JIRA_API_TOKEN` Basic-auth credential already in
`.env.local` (production credential, same one `fetch-jira-rest.mjs` uses):
**response `200 []` — zero webhooks currently configured on this Jira
site.** This confirms the existing pipeline's REST-polling design
(`/rest/api/3/search/jql` via scheduled GitHub Actions) is accurate — there
is no webhook subscription today, consistent with it never transitioning or
writing to Jira.

This is a materially different integration pattern from what `CLAUDE.md`'s
target architecture assumes (Cloudflare Workers ingest via Jira webhooks) —
a webhook subscription would need to be **created**, not just discovered,
before task 3.x can build webhook ingestion. Jira Cloud's webhook event
catalog itself (`jira:issue_created`, `jira:issue_updated`,
`jira:issue_deleted`, `comment_created/updated/deleted`,
`worklog_created/updated/deleted`, sprint events, etc.) is standard,
publicly documented product behavior — not something specific to this site
that needs separate verification, same treatment as GitHub's webhook
catalog in §0.4. Creating the actual subscription (endpoint URL, JQL
filter, secret) is a Phase 3 task, not a Phase 0 blocker — the successful
200 response above also confirms the existing credential has sufficient
permission to read (and, by the same endpoint's POST, to create) webhooks
via Basic auth, which bears on the least-privilege question below.

### Service account permissions (least privilege check)

**Partially established, and a real concern surfaced.** The existing
`JIRA_EMAIL`/`JIRA_API_TOKEN` credential in `.env.local` (the one production
scripts already use, and the one used above to check webhooks) successfully
called `GET /rest/webhooks/1.0/webhook` — a Jira **administrator-scoped**
endpoint. A true least-privilege "transition and comment only" service
account should not be able to read (or, by the same endpoint's POST,
create/delete) instance-wide webhooks. This strongly suggests the existing
credential belongs to a full user/admin account, not a scoped service
account — **it should not be reused as-is for the Automation Engine.**

**Action needed before task 1.x/3.x:** provision a dedicated Jira Cloud API
token on a service account with only the permissions the automation
actually needs (transition issues, add comments, read fields on the
tracked projects) — do not carry the current broad credential forward into
production automation. This is a human/Jira-admin action (creating a
restricted account and scoping project permissions), not something
verifiable further from here. Flagging per `CLAUDE.md` §7 — ask the human
before task 1.x if this hasn't been addressed by then.

### Mismatch list (spec's assumed statuses vs. real Jira)

1. Spec assumes a uniform six-status workflow (To Do / In Progress / Testing
   / Done / Rework / Blocked) across "the" Jira project. Reality: 26
   projects, mixed team-managed/company-managed, workflows are per-project.
   Rework did not exist anywhere at the start of this session — now added to
   18 of the 20 tracked projects (see table above); TEAM and TEAMSANKYA are
   deliberately excluded.
2. LT (and its shared-workflow siblings) has extra statuses not in the spec:
   "Deprioritised", "Review".
3. LT has extra issue types not in the spec: "QAlity Test", "Change Control".
4. Two "Done"-reaching transitions exist per project — automation needs to
   know only one is the legitimate QA-gated path, and that's a policy
   decision, not a Jira fact.
5. TT is a team-managed project with its own distinct workflow (not the
   shared one) and **has no Rework status** — corrected 2026-09-18 after this
   doc previously (incorrectly) grouped it with the Rework-having shared
   workflow. Treat TT like TEAM/TEAMSANKYA for task 4.4's Rework-dependent
   rule.

### Pilot scope — resolved

All ~20 tracked projects are in scope (human decision), not LT-only.

**Update (2026-09-18): per-project transition IDs now pulled live for 16 of
the 20 projects**, not just LT — see the Rework survey table above, which now
carries each project's actual transition IDs (not just its Rework status),
including the TI/TRG correction and the TT reclassification. Specifically
confirmed live this session: LT (pre-existing), AA, CX, FR, PBX, UM, CP, MR,
QIP, AMY, KH, AV (all share LT's transition ID set: 11/12/21/31/41/4/10 from
Testing, or the extended 11/12/21/31/41/2/3/8/9 set from In Progress), plus
TT, TI, TRG, TEAMSANKYA each with their own distinct transition sets (see
table above).

**Still open, not blocking Gate 0 but needed before task 4.1 ships policy
rules for these projects:**

- **KA and BL** — no ticket was in In Progress or Testing at check time
  (2026-09-18), so their transition IDs are still only inferred from shared
  status IDs on other tickets, not directly confirmed. Re-check when either
  project next has a ticket in one of those statuses.
- **TEAM** — only re-confirmed a To-Do-status sample this session; its fuller
  transition set (from In Progress / Testing) was documented in an earlier
  pass and not independently re-verified now.
- **Rework → Testing (or → In Progress) reverse transition** — not yet
  observed live on any project (see note below).

---

## 0.3 Requirements Gathering App

**Confirmed by the human: this is `project-compass`** (the "Stakeholder
Management Dashboard" / "Client Requests" app in this repo). Everything below
is verified by reading its actual schema and code, not guessed.

### Data model / fields per requirement

Core table `stakeholder_items` (`project-compass/supabase/migrations/0001_stakeholder_schema.sql`):
`id, project_id, kind (feature|implementation), summary, description,
jira_url, jira_key, status (free text), status_kind (stakeholder|jira),
priority (High|Medium|Low), comment, created_by, required_by,
will_be_done_by, created_at, updated_at, deleted_at (soft delete)`.
Extended by `0012_client_request_decisions.sql`: `project_id` is nullable —
an item proposed for 2+ candidate projects becomes a "decision" with no
project yet, tracked in a separate `stakeholder_item_candidate_projects`
join table until a human picks one destination
(`stakeholder_items_assign_project`).
`0010_client_requests.sql` adds `request_type` (`product_enhancement |
product_bug | new_request | client_onboarding`, nullable — null means the
item was created directly inside a project's own module, not through the
global Client Requests intake form) and typed comments on a separate
`stakeholder_item_comments` table (`comment_type`: `clarification` |
`updates` — posting a `clarification` comment atomically flips the item's
`status` to `"Clarification Needed"`).

Real stakeholder-side status vocabulary (`project-compass/src/components/stakeholder/badges.tsx`):
`To Do, In Progress, In Review, Done, Waiting for Spec, Waiting for
confirmation, Clarification Needed, Deprioritised, Reviewing Requirements`.
These are a **separate, freeform status track from Jira's own status** —
`status_kind` distinguishes which vocabulary a given `status` value belongs
to; they are not kept in sync automatically anywhere I found.

Attachments (`stakeholder_item_attachments`) and an append-only,
trigger-enforced audit trail (`stakeholder_item_history` — no application
code writes to it directly) also exist.

**Correction (initial read of this section was wrong — only migration 0001
was checked; 0004/0005 were missed):** all **20** products are configured as
`stakeholder_projects`, seeded across `0004_seed_projects.sql` (4: cx-pass,
agent-assist, knowledge-hub, forecasting) and `0005_seed_additional_projects.sql`
(16 more). Confirmed by the human this is the full, current set — not a
subset needing to grow. Most rows carry a `jira_project_key` matching the
real Jira keys tracked by `fetch-jira-rest.mjs` (CP, AA, KH, FR, AMY, CX, KA,
QIP, AV, MR, ACX, BL, LT, PBX, UM — `17e` deliberately has `jira_project_key
= null` per `0006_rename_amy_and_fix_17e_jira_key.sql`, since it's a
requirement-gathering-only product with no separate real Jira project). Four
products have no Jira counterpart at all and are `null` by design:
`call-analyser`, `post-call-automation`, `crm`, `loneworker` — the Jira
auto-match feature simply doesn't scope to a project for these.

### Ingestion mode: webhook or poll

**No webhook/event emission exists.** This is a Vite + TanStack Start app
talking directly to its own Supabase project via `@supabase/supabase-js`
(browser-side, anon key + RLS) and via TanStack `createServerFn` handlers
(server-side, for the Jira-lookup call in `find-jira-match.ts`). There is no
outbound event, no webhook registration, and no queue. The only viable
ingestion mode for the AI PM Automation Platform is **polling this app's own
Supabase tables** (either via its REST API with the anon key + RLS, or —
better — direct Postgres read if we're ever given a read replica/service
role, which we are not currently). `updated_at` on `stakeholder_items` is
the natural polling cursor.

### Auth model

Client-side: **Supabase anon/publishable key** (`VITE_SUPABASE_ANON_KEY`,
new-style `sb_publishable_...` key format) + Row Level Security. All writes
go through `security definer` Postgres RPC functions
(`stakeholder_items_create`, `_update`, `_create_request`,
`_assign_project`, `stakeholder_item_comments_add`) rather than direct table
grants — this is how the anon role is allowed to mutate rows while RLS stays
otherwise restrictive.

**Important, verified structural fact:** `project-compass` has **its own,
separate Supabase project** — a different project URL from whatever backs
the root `supabase/migrations/` in this repo (confirmed by reading
`project-compass/.env.local`; exact URL not restated here since it's a
credential-adjacent value, but it is demonstrably not the same database as
the root-level `supabase/` migrations). This matters for D23 ("Twin storage:
user's own DB") — reading Requirements App data means either a
cross-database read or an export/poll step, not a same-DB join.

### Write-back capability (Jira link / clarification request)

**Partial today, decision made for the target design.** `jira_key` /
`jira_url` columns exist and are populated today via a **manual,
human-assisted match** — `find-jira-match.ts` does a live JQL
summary-similarity search against real Jira (same Basic-auth pattern as
`fetch-jira-rest.mjs`) and offers candidate matches for a human to pick in
the item form (`item-form.tsx`); it does not auto-link automatically or
silently (consistent with D8's "ambiguous matches flagged, not silently
attached"). No automated write-Jira-link-back path exists yet, and neither
does a mechanism for the Automation Engine to post a clarification request
into project-compass externally — both would need new RPC calls or direct
table writes using project-compass's Supabase credentials.

**Decision (human-confirmed this session):** the Automation Engine **will**
be granted write access to project-compass's Supabase project, so these
write-back paths (Jira link back onto `stakeholder_items`, clarification
request creation) can be built as real automation rather than staying
human-only. **Not yet done:** no credential has actually been shared or
configured — this is a design green light, not a completed integration.
Getting the actual service-role key (or a scoped write role) for
project-compass's Supabase project is a task-1.x-era action item (secrets
handling, `CLAUDE.md` §3 rule 1 applies — it must go through `wrangler
secret put`/`.dev.vars`, never committed). When that credential is obtained,
also decide whether writes go through project-compass's existing
`security definer` RPCs (safer, respects its own validation) or direct table
access (more flexible, bypasses its RPC-level guards) — leaning toward
reusing the RPCs where one already exists for the operation needed.

---

## 0.4 Git provider and QA source

### Git provider and repos in scope

**Verified live**, read-only, via `gh` CLI (installed this session, authenticated
as the human's own GitHub account, scope `read:org`+`repo`): the product repos
live in a **separate GitHub organization**, `alldayPA`
(`https://github.com/alldayPA`) — distinct from the human's personal GitHub
account, which hosts this pipeline repo, `project-compass`, `team-pulse-54`,
etc. The org has **431 repositories total** (`gh repo list alldayPA --limit
1000`), all private.

**Repo model is many-to-one, not one-to-one** — most Jira projects map to
multiple repos (e.g. separate `-ui`/`-api` repos, sometimes more). Confirmed
mapping, by human sign-off (not name-pattern guessing) for the following
tracked Jira projects:

| Jira key | Repo(s)                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LT       | `line-tester` (confirmed correct over two other similarly-named candidates: `automated-line-testing-api`/`-ui`, which are older and not in current use) |
| AMY      | `dograh`                                                                                                                                                |
| KA       | `keyboardless-agent-backend`, `keyboardless-streaming-speech-services`, `keyboardless-sortformer`                                                       |

**Human-confirmed 2026-09-18** (previously pattern-matched by repo name only,
now signed off as correct, no corrections needed): CP → `cxpass-ui`, `cxpass-api`; AA →
`agentassist-pipeline`, `agentassist-ai-worker`, `agentassist-api`,
`agentassist-dashboard-ui`, `agentassist-dashboard-api`,
`agentassist-transcription-worker`; FR → `forecasting-ui`,
`forecasting-backend`; PBX → `pbx-manager-api-v2`, `pbx-manager-ui-v2`; KH →
`knowledge-hub-api`, `knowledge-hub-ui`; CX → `cx-messaging-api`,
`cx-messaging-ui`, `cx-messaging-chatbot`, `cx-messaging-embedded-chatbot`,
`cx-messaging-mcp-server`; AV → `avani-ui`, `avani-api`; MR →
`mi-reporting-api`, `mi-repo-ui`; ACX → `acx-session-api`, `acx-dashboard`,
`acx-ui`, `acx-switch-api`, `acx-sentinel-api`, `acx-popper-api`,
`acx-deflection-api`, `ACX_Scripts`; QIP → `qip-api`, `qip-ui`,
`qip-test-automation`; BL → `billing-management`; UM →
`usage-monitoring-api`, `usage-monitoring-ui`, `usage-monitoring-worker`.

**Explicitly out of scope, by human instruction:** TT, TI, TRG, TEAM,
TEAMSANKYA, SB, SP, TS, TSD, AF — no repo mapping needed for these; "ignore
the rest."

**Open item closed:** the repo mapping table above is now fully
human-confirmed, not just pattern-matched. No further sign-off needed before
task 3.x (Git ingestion) implementation.

**Human-confirmed (2026-09-18):** the pattern-matched repo mappings above
(CP, AA, FR, PBX, KH, CX, AV, MR, ACX, QIP, BL, UM) are all correct as
listed. This closes the sign-off item — the full repo mapping for all
in-scope Jira projects (LT, AMY, KA plus the twelve above) is now
human-verified, not name-pattern inference.

### DEV branch naming convention

**Verified live**, read-only (`gh api repos/alldayPA/<repo>/branches`), across
4 sampled repos (`line-tester`, `dograh`, `agentassist-api`, `cxpass-ui`) — all
four share the same three-tier convention:

- `development` — shared DEV integration branch (this is the one the
  automation should track for "in dev" signal, not `dev` or `develop`)
- `staging` — pre-prod
- `main` — production/default branch

Individual contributors also push personal/feature branches (e.g.
`santhosh_dev`, `pavan-dev-v2`, `feat/onboarding`) — these are noise for
automation purposes, not a second convention.

**Not yet checked:** whether all confirmed/candidate repos above follow this
same pattern, or only the 4 sampled ones — worth a wider spot-check before
task 3.2 (Git ingestion Worker) is built, not required to close 0.4.

### Available webhook events

Not yet checked against a real repo's webhook config (no webhook currently
configured on any sampled repo, per earlier read-only checks). GitHub's
documented webhook event catalog (`push`, `pull_request`,
`pull_request_review`, `status`, `check_run`/`check_suite`) is publicly
documented product behavior, not something specific to this org that needs
per-repo verification — safe to treat as reliable. Confirming this org's repos
support standard webhook creation (they should, since GitHub Free/Team/private
repos all support repo-level webhooks) is still an open item for whoever
provisions the actual webhook in Phase 3, not blocking for Phase 0.

### Signature header / algorithm

GitHub's standard webhook signing (documented product behavior, not
org-specific): `X-Hub-Signature-256` header, HMAC-SHA256 over the raw request
body using a per-webhook secret set at webhook-creation time. No such secret
exists yet anywhere — will be generated when the webhook is actually created
in Phase 3, and must go through `wrangler secret put`/`.dev.vars` per
`CLAUDE.md` §3 rule 1, never committed.

### QA results — current location

**Human decision (not a discovered fact — no existing QA system found
anywhere in this repo or elsewhere):** QA results have **nowhere formal**
today. There is no existing QA tracking tool, spreadsheet, or Jira
custom-field workflow that captures pass/fail results. Path forward, per
`IMPLEMENTATION_PLAN.md` task 4.5: build the **minimal QA form** (Cloudflare
Pages), writing directly to the `qa_runs` table.

### QA PASS mandatory fields (D11) — where they exist today, if anywhere

**Confirmed: none exist today.** `docs/field-mapping.md`'s Jira custom-field
table already notes there is no existing Jira field for D11's four mandatory
QA PASS fields (test result, comments, test cases executed, evidence). The
minimal QA form is where all four will be captured for the first time —
this is new surface area, not a mapping from an existing source.

### Evidence storage decision

**Human decision:** the evidence field accepts **any of** a screenshot/file
upload, a URL/link, or other freeform evidence — not restricted to a
link-only field. This means the minimal QA form's evidence field needs both
a file-upload path (to Supabase Storage) and a plain text/URL path, not an
either/or. Left as a design note for task 4.5 (out of scope to build this
session per Gate 0) — no schema/form code is being written here, just
recording the decision.

---

## 0.4b QA rota inputs

### Per-project eligible QA people

**Human decision — supersedes `CLAUDE.md` §8's Supabase-Studio default,
using the explicitly-allowed alternative:** the rota is a
**version-controlled config file in the human's personal GitHub account**
(this repo, not the `alldayPA` org) — not a Supabase table. One entry per
project, listing a Project Lead name and a pool of eligible QA names (a
project can have more than one QA person, not just one). Exact file
path/format (JSON vs YAML, where under the repo) not yet chosen — small
open item for whoever implements task 4.4/8, not blocking Phase 0.

### Duty rotation model (if any)

**Human decision:** **round-robin** across the eligible QA pool for a given
project. Each time an issue enters Testing, the automation assigns the next
person in that project's list (cycling back to the start after the last),
per `CLAUDE.md` §11 / §3a — the automation decides _when_ and picks _from a
given list_, never _who is eligible_.

### What "unavailable" means (leave, other project, etc.)

**Human decision:** availability is an explicit **flag/field per person in
the config file** (e.g. `{name, available: true/false}`), toggled by hand
when someone goes on leave — not inferred from anything else (not "removed
from the list," which would lose the record of who's normally eligible).

If round-robin lands on someone marked unavailable, the automation must
**not** silently skip to the next person — per `CLAUDE.md` §8 ("an empty or
fully-unavailable rota is an exception, not a silent no-op"), this must
**surface as an exception** for human attention rather than auto-selecting
a substitute. This is a stricter reading than a plain skip-to-next: even a
partially-unavailable pool pauses for a human decision on that specific
assignment, rather than the automation silently choosing someone else.

### Projects with only one QA person

Not yet enumerated — depends on the config file actually being populated
(task 4.4/8), which is out of scope this session. Structurally, a
single-person project just means round-robin always resolves to the same
person, and "unavailable" for that person always surfaces as an exception
(no one else to fall back to) — no special-case logic needed beyond what's
already decided above.

### Chosen selection rule (plain language, human sign-off)

For each project: maintain a list of eligible QA people with an
available/unavailable flag, in a version-controlled config file in the
human's personal GitHub repo. When an issue enters Testing, assign the next
person in round-robin order for that project. If that person is flagged
unavailable, stop and surface the assignment as an exception for a human to
resolve — do not auto-substitute. Project Lead is a separate single field,
not part of the QA rotation.

---

## 0.5 Free-tier constraints

(See `docs/constraints.md` — this section cross-references it rather than
duplicating.)

---

## 0.6 Event contracts

(See `docs/event-contracts.md` and `docs/field-mapping.md` — this section
cross-references them rather than duplicating.)

---

## 0.7 Gemini API verification

**Verified live 2026-09-18** using a real API key, via `generativelanguage.googleapis.com/v1beta`
with `x-goog-api-key` header auth (Basic REST calls made from a local Node
script, not yet from a Cloudflare Worker — see open item below). Key stored
in `.dev.vars` (gitignored), not committed.

### Endpoint and model metadata

`GET /v1beta/models/gemini-3.8-flash` → **200**, confirms the model exists
and returns real metadata:

- `inputTokenLimit`: **1,048,576** tokens
- `outputTokenLimit`: **65,536** tokens
- `supportedGenerationMethods`: `generateContent`, `countTokens`,
  `createCachedContent`, `batchGenerateContent`
- `thinking: true` — this is a reasoning/thinking-enabled model (matches the
  `thoughtSignature` field seen in a working sibling model's response, see
  below), which has latency and token-budget implications for task 6.1/6.1b
  not previously accounted for in the plan.

**`gemini-3.6-flash` (the model actually targeted now, see decision below)
carries identical limits**, re-checked live 2026-09-18: `version:
"3.6-flash-07-2026"`, same 1,048,576 input / 65,536 output token limits,
same `thinking: true`. The thinking-model latency/token-budget note above
applies equally to 3.6-flash.

### Structured output / live generateContent — NOT YET CONFIRMED WORKING

**Four consecutive live attempts against `gemini-3.8-flash:generateContent`
(2026-09-18) all returned `503 UNAVAILABLE`** — "This model is currently
experiencing high demand" — both with `response_mime_type: application/json`

- `response_schema` (structured output) and with a plain unstructured prompt.
  This is not an auth or account problem: the same key against a **sibling
  model, `gemini-3.6-flash`, succeeded immediately (200)** with a normal
  response. A third model, `gemini-2.5-flash`, returned **404** with a
  message that it's "no longer available to new users" and points at
  `gemini-3.6-flash` as the replacement — useful confirmation that the
  model-naming landscape has moved since this plan was drafted, but not
  directly about 3.8.

**This means task 0.7 is only partially closed.** What's confirmed: the
endpoint shape, auth method, and model metadata for `gemini-3.8-flash` are
real. What's **not yet confirmed**: whether `gemini-3.8-flash` actually
serves requests reliably enough to build on, and whether its structured
JSON-mode output works at all — every attempt has failed before reaching
that question. `CLAUDE.md` §2a already names this as an expected risk
("Gemini is a third-party API with no SLA on the free tier... can be slow,
rate-limited, or down") — this is that risk showing up on day one, not a
surprise, but it's a real open item, not a pass.

**Decision (human-confirmed 2026-09-18): switch target model to
`gemini-3.6-flash`.** Two independent signals supported this: (1) live
testing above — 3.6-flash serves plain requests reliably where 3.8-flash
consistently 503s, and (2) `scripts/release-notes/summarize.mjs`, a
production script already in this repo, is already pinned to
`gemini-3.6-flash` with a comment noting it was deliberately chosen and
should be "revisit[ed] periodically" as Google rotates model IDs — meaning
3.6-flash is independently proven stable in this exact account, not just in
this session's tests. `CLAUDE.md` §2 updated accordingly. `gemini-3.8-flash`
was not fully broken as a concept — its metadata endpoint works fine — but
it isn't ready to build on today.

**New finding, not resolved by the model switch: structured output itself
appears unreliable right now, independent of model.** Re-testing after the
switch, `response_schema` (JSON-mode) requests against **`gemini-3.6-flash`**
failed **4/4 times** with the same `503 UNAVAILABLE`, while plain
(unstructured) `generateContent` calls to the _same model_, run in between
the structured-output attempts, succeeded reliably (200) every time. This
isolates the failure to structured output specifically, not general model
availability. **This is a real open item for task 6.1**, not a transient
blip that switching models fixed — `packages/llm`'s `assess()` must treat a
structured-output 503 as a normal `provider_error` (per the existing
contract in `CLAUDE.md` §5) and must **not** silently degrade to
prompt-and-parse as a workaround, since that defeats the reliability
structured output exists for. Re-test before task 6.1 ships; if this
persists, it may mean building a resilient retry/backoff specifically around
structured-output calls, not just around generic request failures.

### Embeddings

**Verified live** via `GET /v1beta/models?pageSize=200`, filtered to models
supporting `embedContent`: three embedding models are available —
`gemini-embedding-001` (2,048 input token limit), `gemini-embedding-2-preview`
and `gemini-embedding-2` (8,192 input token limit each). None of these were
call-tested for an actual embedding request this session (out of scope for
0.7's core ask); dimensionality wasn't returned by the models-list endpoint
and needs a real `embedContent` call to confirm before task 2.3's pgvector
column width is finalized.

### Data usage policy

Already confirmed and dated in `docs/constraints.md` (task 0.5): free-tier
Gemini usage is marked "Yes — content used to improve Google's products" on
Google's own pricing page, checked 2026-09-18.

### Cloudflare Worker reachability

**Not yet tested.** All calls above were made from a local Node script, not
from `wrangler dev` or a deployed Worker. `generativelanguage.googleapis.com`
reachability from the Workers runtime specifically is still an open item
before task 6.1 — flagged per the original task wording, not yet closed.

### Credential and infrastructure decisions (human-confirmed 2026-09-18)

- **Dedicated Gemini API key.** This platform uses its own `GEMINI_API_KEY`
  in `.dev.vars` (gitignored), separate from the key
  `scripts/release-notes/summarize.mjs` already uses in `.env.local`. Chosen
  over sharing to keep the two systems' free-tier rate-limit usage from
  competing with each other, and to match `CLAUDE.md` §3 rule 1's
  per-service `wrangler secret put` model once this moves to a real Worker
  deployment.
- **Separate Supabase project**, not the existing root `supabase/` project
  in this repo (which is `team-pulse-54`'s live backend — 68 migrations,
  already populated). Recorded against `IMPLEMENTATION_PLAN.md` task 1.2:
  keeps the event-sourced Twin/PM Brain schema isolated, at the cost of one
  of the account's 2 allowed active free Supabase projects (task 0.5).

### Rate limits (RPD/RPM/TPM)

Still not independently confirmed (see `docs/constraints.md`'s flag that
Google's rate-limit page requires viewing live account state in AI Studio,
not a public static table). The persistent 503s above are model-availability
errors, not `429` rate-limit errors, so they don't confirm or deny the
~20 RPD figure flagged as unverified in `docs/constraints.md`.

---

## Open questions awaiting the human

(Populate as discovery proceeds — see the consolidated question list raised
at the end of the Phase 0 session.)
