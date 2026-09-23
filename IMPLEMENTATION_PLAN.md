# IMPLEMENTATION_PLAN.md

Ordered task list. Read `CLAUDE.md` first — it contains the hard rules.

## How to use this document

Work top to bottom. Each phase has a **gate**: do not start the next phase until
the gate passes. Each task has:

- **Goal** — what outcome we want
- **Do** — the work
- **Check** — what to verify, including things you must not assume
- **Done when** — the acceptance test
- **Ask if** — the condition under which you stop and come to the human

Mark tasks complete in this file as you go. If a task turns out to be wrong
because of something you learned in discovery, amend the plan and say so
explicitly rather than silently doing something different.

The phase numbering here **deliberately differs from the source spec**: safety
infrastructure (action log, kill switch, shadow mode) has been pulled forward
from the spec's Phase 11 to Phase 5, and the spec's Phases 8–10 (Epic
intelligence, delivery intelligence, predictive analytics) are moved to the
backlog. Do not reorder back.

**Sequencing decision (2026-09-18):** Phase 7 (PM Brain and the richer Twin
query/contradiction layer) is explicitly deferred until Phases 1–5 ship and
run against a real project. Near-term priority is requirements → Jira → Git
→ QA automation, deterministic, zero AI. The PM Brain tables task (formerly
2.3) moved from Phase 2 to sit inside Phase 7 (now 7.0) — do not create those
tables early "just in case." This does not touch Phase 6 (AI requirement
intelligence) — Gemini work is still in its original position unless told
otherwise.

---

# Phase 0 — Discovery

Nothing in this system can be built correctly without this phase. Its output is
the contract every later phase depends on. Expect this to be mostly reading,
API-poking, and asking questions — not coding.

### 0.1 Convert and index the source spec

- **Goal:** the spec is readable and greppable.
- **Do:** `pandoc -t markdown` the uploaded `.docx` into `docs/spec.md`. Extract
  the 30 locked decisions (D1–D30) into `docs/decisions.md` as a table.
- **Check:** all 26 table definitions from spec §6 survived the conversion.
- **Done when:** `docs/spec.md` and `docs/decisions.md` exist and are complete.

### 0.2 Map the real Jira configuration

- **Goal:** know the actual workflow, not the idealized one.
- **Do:** against the real Jira instance, record: project keys; issue types;
  **exact** status names; **transition IDs** for every transition the automation
  needs (To Do→In Progress, →Testing, →Done, →Rework, →Blocked); custom field IDs
  for estimate hours and any QA fields; the sprint/board API shape; and which
  webhook events are available.
- **Check:** the spec's assumed statuses (To Do, In Progress, Testing, Done,
  Rework, Blocked) may not exist verbatim. Record what is actually there and note
  every mismatch. Confirm whether it's Jira Cloud or Data Center — the auth model
  and webhook mechanism differ. Confirm the service account's permissions are
  sufficient to transition and comment but no broader (least privilege).
- **Done when:** `docs/discovery.md` has a transition table with real IDs, and a
  named mismatch list.
- **Ask if:** you lack Jira credentials, or a required transition doesn't exist
  and the workflow would need editing.

### 0.3 Map the Requirements Gathering App

- **Goal:** know how requirements get in and how we link back.
- **Do:** document its data model, the fields available per requirement, whether
  it can emit webhooks or must be polled, its auth model, and whether we can
  write back a Jira link / clarification request to it.
- **Check:** this is the source of truth for requirements (D22) — if it cannot
  emit events _and_ cannot be polled, the whole ingestion design changes. Find
  out before designing.
- **Done when:** documented in `docs/discovery.md`, including the ingestion mode
  (webhook vs. poll) we will actually use.
- **Ask if:** there is no API at all.

### 0.4 Map Git provider and QA source

- **Goal:** know the PR/commit event contracts and where QA results live.
- **Do:** confirm the Git provider, repos in scope, DEV branch names, available
  webhook events (branch create, push, PR opened/merged), and the signature
  header/algorithm. Separately: find out where QA results are recorded today and
  whether the four mandatory PASS fields (test result, comments, test cases
  executed, evidence — D11) exist anywhere yet.
- **Check:** if there is no QA system with an API, the plan is to build a minimal
  QA form on Cloudflare Pages writing straight to `qa_runs`. Confirm that's
  acceptable rather than assuming it.
- **Done when:** both documented; evidence storage location decided.

### 0.4b Capture the QA rota inputs

- **Goal:** know who can be assigned QA, per project, before building assignment.
- **Do:** from the human, record per project: the eligible QA people, how duty
  rotates (if at all), what "unavailable" looks like (leave, other project), and
  whether any project has only one QA person.
- **Check:** read `CLAUDE.md` §3a and §8 first. Eligibility is **human-supplied
  input**, not something to infer. Do not design skill matching, workload
  balancing, or AI-driven people selection. If the human hasn't given you the
  list, you do not have it.
- **Done when:** `docs/discovery.md` records the rota inputs and the chosen
  selection rule (e.g. on-duty person, else round-robin over eligible) in plain
  language, signed off by the human.
- **Ask if:** any project's rota would be empty, or duty rotation is more complex
  than a single on-duty selection — that changes the schema in task 2.2b.

### 0.5 Verify free-tier constraints

- **Goal:** no design built on a limit that doesn't exist.
- **Do:** check current docs for Supabase free-project limits (DB size, the
  inactivity-pause behaviour and its window) and Cloudflare free-plan limits
  (Worker requests/day, CPU time per invocation, cron trigger count, KV
  operations) and Gemini free-tier data policy. Record each with the date
  checked. **Gemini rate limits (RPM, RPD, TPM) are assumed more than sufficient
  for our volume** — record the actual numbers for reference but do not design
  around them unless you hit one.
- **Check:** confirm explicitly that Queues and Durable Objects are paid-only —
  if that has changed, tell the human, it simplifies the event pipeline.
- **Done when:** `docs/constraints.md` exists with dated, sourced numbers.

### 0.6 Write the event contracts

- **Goal:** one normalized internal event schema.
- **Do:** for each source, map its real payload to the internal event vocabulary
  from spec §8. Define the normalized event shape: `source`, `event_type`,
  `project_id`, `entity_type`, `entity_id`, `actor`, `timestamp`, `payload`,
  `correlation_id`, plus the provider's own event ID for deduplication.
- **Check:** every source must supply something usable as a stable dedup key. If
  one doesn't, define a deterministic hash and document it.
- **Done when:** `docs/event-contracts.md` and `docs/field-mapping.md` complete.

### 0.7 Verify Gemini 3.6 Flash API access

- **Revised 2026-09-18:** target model switched from `gemini-3.8-flash` to
  `gemini-3.6-flash`. Live testing found 3.8-flash returning `503
UNAVAILABLE` on every attempt (structured and plain), while a production
  script already in this repo (`scripts/release-notes/summarize.mjs`) has
  been running successfully against `gemini-3.6-flash` — human decision to
  switch rather than wait on 3.8. See `docs/discovery.md` §0.7 for the full
  investigation, including a separate, still-open finding: structured output
  itself (`response_schema`) failed 4/4 times against **both** models,
  independent of which one — plain `generateContent` succeeded reliably in
  between. This is not resolved by the model switch and needs to be handled
  as a real failure mode in the `assess()` implementation (task 6.1), not
  assumed away.
- **Goal:** confirm the LLM is callable and know its contract before designing
  around it.
- **Do:** record in `docs/discovery.md`:
  - The exact API endpoint and path (likely
    `generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`
    but **verify, do not assume**).
  - Authentication method (API key via `x-goog-api-key` header or query param).
  - Whether `response_mime_type: application/json` with `response_schema` works
    on the free tier for this model — this is the structured output path and
    changes the entire parsing strategy.
  - The effective context window (input token limit).
  - Whether a Gemini embedding model is available on the free tier, its
    dimensionality, and its rate limits — this drives the pgvector column in
    task 7.0 (formerly 2.3, deferred alongside PM Brain — see Phase 7). If no
    free embedding model is suitable, decide the alternative
    (e.g. a lightweight open model run in a Supabase Edge Function) before
    writing the schema.
  - The free-tier data usage policy: does Google use free-tier inputs for model
    training? Record the specific terms page URL and date checked.
- **Check:**
  - Make a real request and record the full request/response. Do not design
    against documentation alone.
  - Confirm that the Cloudflare Worker environment can reach the Gemini endpoint
    — `generativelanguage.googleapis.com` is not in the network allowlist, so
    check whether external fetch from Workers is unrestricted or requires an
    addition. If it is blocked, stop and ask.
  - Record the `model` field from the API response — Google may silently update
    Flash. This is what gets stamped on assessments, not a hardcoded string.
- **Done when:** a successful structured-output request from a Cloudflare Worker
  (or `wrangler dev`) to Gemini, with response recorded, and the data policy
  documented.
- **Ask if:** structured output is not available on the free tier, or the data
  policy is unacceptable for the types of projects this system will handle.
- **Carried forward to Phase 1/6 (2026-09-18):** two checks from this task
  couldn't be completed without infrastructure that doesn't exist yet —
  no Worker/`wrangler` skeleton exists before Phase 1. Do not consider these
  closed; they're explicit follow-ups, not dropped:
  1. **Cloudflare Worker reachability** of `generativelanguage.googleapis.com`
     — verify from a real `wrangler dev` session as part of task 1.3.
  2. **Structured-output reliability** — `response_schema` requests failed
     4/4 times live against `gemini-3.6-flash` (see `docs/discovery.md`
     §0.7) while plain generation succeeded reliably. Re-test before task
     6.1 ships the real `assess()` implementation; if it's still unreliable,
     the retry/error-handling design for `packages/llm` needs to account for
     it explicitly, not assume it was a one-off.

> ### Gate 0 — passed 2026-09-18, with two follow-ups carried forward (see
>
> task 0.7 above; both non-blocking per human decision)
> `docs/discovery.md`, `constraints.md`, `field-mapping.md`, `event-contracts.md`
> all exist. Every Jira transition the automation needs has a real ID. No
> external system contract is still a guess. **Do not write application code
> before this gate passes.**

---

# Phase 1 — Repo and infrastructure skeleton

### 1.1 Initialize the monorepo

- **Revised 2026-09-18:** the repo root is already `tanstack_start_ts` (its
  own `package.json`/`vite.config`/`tsconfig.json`/CI scripts) — confirmed
  live, not assumed. This project's own workspace lives entirely under a new
  `ai-pm-platform/` subdirectory instead, per `CLAUDE.md` §4's revised
  layout, matching how `project-compass/` and `team-pulse-54/` are already
  structured in this repo.
- **Do:** create `ai-pm-platform/` with its own `package.json` (own
  workspace manager config, not inherited from root), shared `tsconfig.json`,
  linting, and a test runner that runs in CI, scoped to that path. Set up the
  layout in `CLAUDE.md` §4 underneath it.
- **Check:** CI workflow(s) for this project should trigger on changes under
  `ai-pm-platform/**` specifically, not the whole repo — the root app and
  `project-compass`/`team-pulse-54` already have their own CI concerns and
  shouldn't rebuild on this project's changes or vice versa.
- **Done when:** `test` and `lint` pass on an empty `ai-pm-platform/` project
  in CI, without touching or breaking the root app's own `test`/`lint`/`build`
  scripts.

### 1.2 Provision Supabase

- **Do:** create **a new, separate free Supabase project** — human-confirmed
  2026-09-18 not to reuse the existing root `supabase/` project in this repo
  (which is `team-pulse-54`'s live backend, 68 migrations already in it, per
  `docs/discovery.md`). This platform's event-sourced Twin/PM Brain schema
  stays isolated from team-pulse-54's operational tables: cleaner RLS
  boundaries, no migration-numbering collisions. This uses one of the
  account's 2 allowed active free projects (`docs/constraints.md`, task 0.5)
  — confirm the other slot (presumably team-pulse-54's) stays within that cap
  before creating this one. Enable `pgvector`. Record the connection approach.
  Configure local development against it.
- **Check:** confirm whether the free project pauses on inactivity and over what
  window — **already confirmed in task 0.5: 7 days**, so task 3.6 needs a
  keep-alive cron ping within that window regardless.
- **Ask if:** you need the human to create the account or hand over keys.

**Done — 2026-09-18.** Human created the project and handed over credentials
directly in chat (URL, anon key, service_role key, DB password). Verified
live, not assumed:

- Project ref `yfrhgvkjroliiaojevdj` (decoded from the JWT keys), URL
  `https://yfrhgvkjroliiaojevdj.supabase.co`.
- **`service_role` key confirmed working** against `/rest/v1/` (200,
  returned the PostgREST OpenAPI spec). **The legacy JWT `anon` key was
  rejected** — `401 "Only the service_role API key can be used for this
endpoint"`. This project appears to have Supabase's newer key-format
  defaults, matching what `docs/discovery.md` §0.3 already found for
  `project-compass`'s separate Supabase project (`sb_publishable_...`
  format). Not blocking — Workers use `service_role` per `CLAUDE.md`/task
  2.5 anyway — but if anything ever needs anon+RLS client access, it'll need
  the new-format publishable key, not this JWT anon key.
- **`DATABASE_URL` connection confirmed live** via a direct `pg` client
  query: `PostgreSQL 17.6` on the pooler endpoint
  (`aws-0-ap-southeast-2.pooler.supabase.com:5432`). Note the DB password
  contains characters (`#`, `@`, `&`) requiring URL-encoding in the
  connection string — used as given, not re-derived.
- **`pgvector` enabled and confirmed**: `create extension if not exists
vector` succeeded, `pg_extension` confirms version `0.8.2` installed. This
  is a DB-level flag only — no PM Brain tables were created (still deferred
  to Phase 7 per the 2026-09-18 scope decision).
- Credentials stored in `ai-pm-platform/.dev.vars` (gitignored, confirmed
  via `git check-ignore`) — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Not committed anywhere.
- **Confirmed (human, 2026-09-18):** team-pulse-54's is the only other
  active project on this account. This new project is the 2nd of the
  2-project free-tier cap — exactly at the limit, not over it. No further
  free Supabase project can be provisioned on this account without pausing
  one of these two first.

### 1.3 Wire Cloudflare

- **Do:** `wrangler` config for one hello-world Worker, a KV namespace for
  feature flags. No Workers AI binding — inference does not run on Cloudflare.
  Deploy it.
- **Done when:** the Worker responds in production and can read a KV key.

**Done — 2026-09-18.** Human provided a Cloudflare API token (`Edit
Cloudflare Workers` template) and the account ID was fetched live via
`GET /client/v4/accounts` (one account, `22e527436f21fe468317a74b3204c712`,
no ambiguity). Both stored in `ai-pm-platform/.dev.vars` alongside the
Supabase/Gemini keys.

- `wrangler` and `@cloudflare/workers-types` added as devDependencies.
- `ai-pm-platform` converted to an **npm workspaces root**
  (`workers/*`, `packages/*`) — this is the point the plan's own task 1.1
  "own workspace manager config" actually needed to exist, now that a real
  subpackage exists. Root `test`/`typecheck` scripts now cascade into
  workspace members via `--workspaces --if-present`.
- KV namespace `FEATURE_FLAGS` created (`aa148ad48b08459e9811aa3b4d29b006`).
- `workers/hello-world` created (own `package.json`, `wrangler.jsonc`,
  worker-specific `tsconfig.json` using `@cloudflare/workers-types` instead
  of the root config's Node types) and deployed:
  `https://ai-pm-platform-hello-world.bhardwarsavina.workers.dev`.
- **Verified live, not assumed:** seeded a `status` key into the KV
  namespace, curled the deployed Worker in production, got the KV value
  back in the response — confirms both "responds in production" and "can
  read a KV key" for real.
- **Snag hit and resolved:** `wrangler deploy` initially failed with a
  config-ambiguity error against `.wrangler/deploy/config.json` at the repo
  root — a **pre-existing file from July 29, unrelated to this project**
  (belongs to the root `tanstack_start_ts` app's own prior Cloudflare
  Pages/Nitro build, referencing `.output/server/wrangler.json`). Per the
  locked "do not modify the root app" instruction, this file was left
  untouched; fixed by passing `--config ./wrangler.jsonc` explicitly from
  `workers/hello-world` instead of relying on wrangler's upward config
  auto-discovery. **Anything that runs `wrangler` from within
  `ai-pm-platform` going forward should pass `--config` explicitly** to
  avoid the same ambiguity — worth carrying into task 1.4's CI deploy step
  and every later Worker.
- All lint/typecheck/test checks re-verified green after the workspace
  conversion.

### 1.4 Secrets hygiene and CI

**Done — 2026-09-18.**

- `.gitignore` coverage: already global from before this project existed
  (`.dev.vars`, `node_modules`, `*.local`, etc. at repo root, confirmed via
  `git check-ignore` for both `.dev.vars` files). No change needed.
- **Pre-commit secret scan**: `.githooks/pre-commit` (new, repo-root level —
  not a modification to the root app, analogous to `.github/workflows/`)
  blocks a commit containing anything shaped like a live secret (AWS-style
  keys, JWTs, `*_KEY`/`*_TOKEN`/`*_SECRET` assignments, `sk-`/`cfut_`
  prefixes) or a staged file named `.dev.vars`/`.env*`. Activated via
  `git config core.hooksPath .githooks`, run automatically by
  `ai-pm-platform`'s own `prepare` npm lifecycle script
  (`ai-pm-platform/scripts/install-hooks.mjs`) — anyone who runs
  `npm install` inside `ai-pm-platform` gets the hook installed repo-wide.
  **Verified live, not assumed**: staged a file containing
  `FAKE_API_KEY=` followed by an AWS-access-key-shaped fake value, ran
  `git commit` — blocked, exit code
  1. Then staged all of today's real `ai-pm-platform` files and ran the hook
     directly — exit code 0, no false positives, and confirmed `.dev.vars`
     never enters the staging area even via a directory-wide `git add` (two
     independent layers: `.gitignore` + the hook's filename check).
- **CI workflow** (`.github/workflows/ai-pm-platform-ci.yml`, created in
  task 1.1, extended here): `checks` job runs lint/typecheck/test on every
  PR and push to `main` scoped to `ai-pm-platform/**`; a new `deploy` job
  runs only `on: push` to `main` (not PRs), gated on `checks` passing first,
  and runs `wrangler deploy --config ./wrangler.jsonc` from
  `workers/hello-world` — the explicit `--config` flag carries forward the
  fix from task 1.3's root `.wrangler/deploy/config.json` collision.
- **Worker secrets**: none needed yet — `hello-world` only reads KV, no
  Gemini/Supabase calls. `wrangler secret put` applies once a real Worker
  (ingest-jira, scheduler, etc.) needs one; nothing to do here today.
- **GitHub Actions secrets**: `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` stored via `gh secret set`, confirmed present via
  `gh secret list`. **Not yet added**: a dedicated `GEMINI_API_KEY`/
  Supabase secret for `ai-pm-platform`'s own CI — the existing
  `GEMINI_API_KEY`/`SUPABASE_DB_URL` GitHub secrets belong to
  `release-notes`/`team-pulse-54` respectively (per the earlier
  dedicated-credential decision, `docs/discovery.md` §0.7) and should not be
  reused. Add this platform's own when a CI job actually needs to call
  Gemini or Supabase — not required for today's hello-world deploy.
- **Caveat, stated plainly:** the `deploy` job has **not yet run for real**
  — nothing from this session has been committed/pushed. The pre-commit
  hook and manual `wrangler deploy` were both verified directly; the GitHub
  Actions workflow itself is unverified until a real push to `main` happens.
  That's a commit/push action, which needs explicit go-ahead rather than
  being done automatically.
- **Original task wording below, retained for reference:**

- **Do:** `.gitignore` for `.dev.vars` and env files; a pre-commit secret scan;
  GitHub Actions workflow running lint + tests on PR and `wrangler deploy` on
  merge to main. Store all tokens as GitHub Actions secrets and Worker secrets.
- **Done when:** a deliberately planted fake key is blocked by the pre-commit
  hook, and CI deploys on merge.

> ### Gate 1 — substantively passed 2026-09-18, one caveat
>
> Empty deployable pipeline, no secrets in the repo, CI green.
> Deployable pipeline confirmed live (hello-world Worker deployed and
> verified reading KV in production, task 1.3). No secrets in the repo,
> verified two ways (pre-commit hook + `.gitignore`, task 1.4). **CI green
> is unverified** — the workflow exists and was reviewed, but nothing has
> been pushed to `main` yet, so it hasn't actually run. Confirm this for
> real the first time something merges to `main`.

---

# Phase 2 — Database schema

### 2.1 MVP tables

- **Goal:** the core of spec §6, not all of it.
- **Do:** forward-only numbered migrations for: `users`, `projects`,
  `project_configurations`, `project_members`, `requirements`,
  `requirement_assessments`, `epics`, `issues`, `sprints`, `events`.
- **Check:** use the spec's column lists verbatim where they're sound. Add
  `created_at`/`updated_at` everywhere. `events` must be **append-only** —
  enforce it (revoke update/delete, or a trigger).
- **Done when:** migrations run clean on a fresh DB and are re-runnable from
  zero.

**Done — 2026-09-21.** `ai-pm-platform/db/migrations/0001_mvp_tables.sql`
created and applied live against the real Supabase project from task 1.2.
All 9 tables present, verified via `information_schema.tables`. Two
deliberate deviations from spec.md's column lists, both called out inline
in the SQL as comments, not silent:
- `requirement_assessments` gained `model` and `prompt_version` columns —
  spec.md omits them, but `CLAUDE.md` §5 requires stamping the model that
  actually served each response for auditability. A real gap between the
  spec and the hard rules, not an invented addition.
- `events` gained `provider_event_id` (unique on `(source,
  provider_event_id)`) — spec.md's own `events` column list has no dedup
  key at all, which would make the table wrong from creation, not just
  incomplete pending task 2.4. Pulled forward from task 2.4 rather than
  left as a known gap.

`sprints` also gained `goal` (flagged as a recommended addition in
`docs/field-mapping.md`, not spec.md). QA Assignee/Planned Hours
(`customfield_10690`/`10691`) were deliberately **not** added to `issues` —
that's `assignments`/the QA rota's job (task 2.2/2.2b), not a mirrored
column.

**Verified live, not assumed:**
- `events` append-only trigger: a real `UPDATE` and `DELETE` against a row
  both failed with the trigger's exception, confirmed by catching the
  errors directly, not by reading the trigger definition and assuming it
  works.
- Dedup constraint: inserting the same `(source, provider_event_id)` twice
  failed on the unique constraint as intended.
- Re-runnability: dropped all 9 tables plus both trigger functions,
  reapplied the same migration file, succeeded identically.

All tables have RLS enabled with **no policies yet** (default-deny for
anon/authenticated, service role unaffected) — a safer default than leaving
them open until task 2.5 writes the real policies. `created_at`/`updated_at`
applied to every table except `requirement_assessments` and `events`, which
are append-only/versioned by design (a new row per version/event, never a
mutated one) — `updated_at` would be actively misleading on those two.

### 2.2 Delivery tables

- **Do:** `assignments`, `dependencies`, `branches`, `commits`,
  `pull_requests`, `qa_runs`. Defer `bugs` (D13 defers bug automation).
- **Check:** `qa_runs` needs `cycle_number` so each QA attempt is its own row —
  this is what makes rework measurable. Don't collapse it to one row per issue.

**Done — 2026-09-22.** `ai-pm-platform/db/migrations/0002_delivery_tables.sql`
created and applied live against the real Supabase project. All 6 tables
present (`assignments`, `dependencies`, `branches`, `commits`,
`pull_requests`, `qa_runs`); `bugs` deferred per D13, matching the task.

**Deviations from spec.md's column lists, all inline-commented:**
- `assignments` gained a partial unique index
  `(issue_id, assignment_type) where active` — enforces task 4.4b's
  idempotency requirement ("if the issue already has an active QA
  assignment, skip") at the DB level rather than trusting application
  logic alone.
- `branches` gained `unique (repository, branch_name)` — not in spec.md,
  but branches have no other external identifier and CLAUDE.md hard rule 4
  requires idempotent upserts on every event path; same reasoning as
  `events.provider_event_id` in migration 0001.
- `commits`/`pull_requests` gained `unique (repository, commit_hash)` /
  `unique (repository, external_pr_id)` — these were already explicitly
  named in task 2.4's own wording ("commit hash per repo", "PR external
  ID"), so added now rather than left as a known gap until task 2.4.
- `qa_runs.evidence` is `jsonb`, not a single text/url column — encodes
  `docs/discovery.md` §0.4's human decision that evidence accepts any of a
  file upload, a URL, or freeform text, potentially more than one, not an
  either/or single field.
- `qa_runs` has two `CHECK` constraints encoding D11 and D12 directly at
  the DB level: PASS requires `test_result`, `comments`,
  `test_cases_executed`, and at least one evidence entry; FAIL requires a
  `failure_reason` from the exact category list task 4.5 already
  enumerates (`developer_defect`, `requirement_issue`,
  `requirement_change`, `dependency`, `environment`, `test_data`,
  `qa_issue`, `other`). Matches task 4.4's own instruction that "PASS
  validation must be server-side and unbypassable."

**Verified live, not assumed** — a script inserted real rows and confirmed
every constraint actually fires: PASS rejected without required fields,
accepted with them; FAIL rejected without a reason and with an invalid
category, accepted with a valid one; a second active QA assignment on the
same issue rejected; a self-referencing dependency rejected. Re-runnability
re-confirmed by dropping all 15 tables (both migrations) and both trigger
functions, then reapplying 0001 and 0002 in order — identical result.

**One unrelated thing caught and reverted, not committed:** running these
verification scripts from the repo root caused `npm install` (triggered
incidentally, not by anything migration-related) to add a stray
`context-mem` devDependency to the **root** `package.json`/
`package-lock.json` — almost certainly a side effect of the `context-mem`
MCP server configured in `.mcp.json`. Reverted via `git checkout --
package.json package-lock.json` before anything was staged. Root app
untouched, as required.

**Scope change (human-confirmed 2026-09-18):** the PM Brain tables task that
used to sit here as 2.3 (`pm_brain_entries`, `pm_brain_links`, embeddings) is
**deferred to Phase 7**, alongside the rest of PM Brain and the richer Twin
query work. Near-term priority is requirements → Jira → Git → QA automation
(Phases 1–5) with zero AI, shipped and run against a real project first. See
Phase 7's header for the full rationale. `events` and the current-state
tables in 2.1/2.2 are **not** deferred — ingestion needs them regardless,
and they're the Twin's actual data, just not its richer query/contradiction
layer.

### 2.2b QA rota table

- **Goal:** the human control surface for QA assignment, per `CLAUDE.md` §8.
- **Do:** one migration adding a rota per project. Suggested shape, adjust to
  what task 0.4b actually found:

  | Column                     | Purpose                                                |
  | -------------------------- | ------------------------------------------------------ |
  | `project_id`               | FK, unique — one rota per project                      |
  | `eligible_user_ids`        | human-maintained list of who may be assigned QA        |
  | `on_duty_user_id`          | nullable; if set, assignment prefers this person       |
  | `selection_rule`           | enum, e.g. `on_duty` \| `round_robin` \| `manual_only` |
  | `last_assigned_user_id`    | supports round-robin without a separate counter        |
  | `paused`                   | boolean; suspends auto-assignment for this project     |
  | `updated_by`, `updated_at` | so the action log can explain past assignments         |

  Plus a separate per-issue override: `issue_id`, `qa_user_id`, `created_by`,
  `consumed_at` (nullable).

- **Check:** the override table needs `consumed_at` so an applied override is
  not re-applied on the next cron tick. Do not model overrides as a mutable
  field on the rota row. Every user id must FK to `users` and be validated as an
  active member of that project (D4 allows cross-project people, so membership
  is the check, not global existence).
- **Done when:** the rota and override rows are editable in Supabase Studio, and
  a test proves a non-admin role cannot write either (RLS, per task 2.5).
- **Ask if:** task 0.4b found duty rotation more complex than a single on-duty
  person — a schedule table is a different shape and needs confirming first.

**Done — 2026-09-22, implemented differently from this task's original
suggested shape.** The single-table design above assumed the Supabase
default from `CLAUDE.md` §8. That default was already overridden on
2026-09-18 (`docs/discovery.md` §0.4b, human decision): eligibility lives
in a version-controlled JSON file, not a Supabase table. That decision only
covered *eligibility* data, though — it left open where the round-robin
cursor and per-issue overrides should live, since those are written
automatically on every QA assignment, not human-curated. **Asked the human
before building anything** (per this session's "ask if a decision needs to
be made" instruction): confirmed a split —

- `ai-pm-platform/config/qa-rota.json` (+ `qa-rota.schema.json`, `README.md`
  explaining the split and why) — the eligible QA pool and Project Lead per
  project, human-edited, git-reviewed. Currently `"projects": {}` — no QA
  people have been enumerated yet (discovery.md §0.4b left this open;
  populating it is a separate, later action, not part of this task).
  **Implementation refinement, flagged not silent:** matches people by
  **email**, not the "names" discovery.md's wording used — email is
  `unique not null` on `users` already (migration 0001) and avoids
  typo/duplicate-name matching risk. Documented in the config README.
- `ai-pm-platform/db/migrations/0003_qa_rota_state.sql` — `qa_rota_state`
  (one row per project: `last_assigned_user_id`, `paused`, `updated_by`,
  `updated_at`) and `qa_assignment_overrides` (`issue_id`, `qa_user_id`,
  `created_by`, `created_at`, `consumed_at`) for the automation-writable
  state. A partial unique index enforces "only one *unconsumed* override
  per issue" per `CLAUDE.md` §8's wording, encoded at the DB level rather
  than trusted to application logic.

**"Done when" superseded:** "editable in Supabase Studio" no longer
applies to eligibility (it's a git file now); RLS is enabled on both new
Supabase tables with no policies yet (task 2.5), same as every other table
so far. **Verified live, not assumed:** a script inserted real rows and
confirmed both constraints actually fire — a second `qa_rota_state` row for
the same project rejected, a second pending override on the same issue
rejected, and a new pending override correctly allowed once the prior one
is marked consumed. Re-runnability re-confirmed across all three migrations
(0001–0003) from a fully dropped schema.

**Not built here, deliberately:** the actual round-robin resolution logic
(read the git file, read the Supabase state, pick the next eligible
person, raise an exception if empty/paused/all-unavailable) is task 4.4b's
job in Phase 4, once the Policy/Automation Engine split exists to run it
in. This task only ships the schema both halves need.

### 2.4 Constraints, indexes, idempotency keys

- **Do:** foreign keys; a unique constraint supporting event deduplication
  (`source` + provider event ID); unique keys on external identifiers
  (`jira_issue_key`, PR external ID, commit hash per repo); indexes on every FK
  and on `events(project_id, timestamp)`.
- **Done when:** inserting the same event twice raises a conflict that the
  upsert path handles cleanly.

**Done — 2026-09-22.** Most of this task was actually already satisfied
inline as each table got built in migrations 0001–0003 (FKs, the events
dedup constraint, and every external-identifier unique constraint the task
names — `jira_issue_key`, PR external ID, commit hash per repo — were all
added at table-creation time, not deferred). What was genuinely still
missing, audited explicitly rather than assumed complete:
**indexes on FK columns** — Postgres does not auto-index foreign keys (only
primary keys get one automatically), so every FK across all three prior
migrations needed checking. `ai-pm-platform/db/migrations/0004_fk_indexes.sql`
adds one for every FK not already covered by a unique constraint's
leftmost-prefix match, with each skip commented inline so the reasoning is
auditable later — including a subtlety: **partial** unique indexes
(`assignments`, `qa_assignment_overrides`) don't count as real coverage,
since they only index the subset of rows matching their `WHERE` clause; a
plain index was added alongside each one for the rest of the table.

**Verified live, not assumed:** `pg_indexes` counted per table after
applying (2–7 indexes per table, matching what each table's constraints +
this migration should produce). The actual "Done when" wording — an
**upsert path**, not just a raw duplicate `INSERT` — was tested
specifically: `INSERT ... ON CONFLICT (source, provider_event_id) DO
NOTHING` on a duplicate event returned 0 rows with no error, confirming
the real idempotent-upsert pattern the ingest Workers will use in Phase 3
works cleanly, not just that a naive duplicate insert throws (already
proven in task 2.1). Re-runnability re-confirmed across all four
migrations from a dropped schema.

### 2.5 Permissions

- **Do:** Row Level Security reflecting D3 and D20 — project configuration is
  PM/Admin only; automation override is PM/Admin only. Service role for Workers.
- **Done when:** a test proves a non-admin role cannot write
  `project_configurations`.

**Done — 2026-09-22, after asking a real decision first.** Nothing in this
project had ever decided how a human authenticates to this database — no
Supabase Auth wiring, no link from `users` to `auth.users`, no login flow
(Phase 8's Control Centre doesn't exist yet). Asked the human before
guessing at that contract (per this session's standing instruction and
`CLAUDE.md` §3 rule 2's spirit): build the minimal real wiring now, not
defer indefinitely.
`ai-pm-platform/db/migrations/0005_rls_project_configurations.sql`:
- `users.auth_user_id uuid unique references auth.users(id)` — links our
  internal `users` to Supabase Auth. Nullable: not every tracked person
  (e.g. someone only known as a Jira assignee) necessarily has login
  access.
- `users.role` gained a `CHECK (role in ('member', 'pm', 'admin'))` —
  wasn't constrained before; needed so the RLS check below can't silently
  no-op on a typo'd role string.
- `current_app_user_role()`, a `SECURITY DEFINER` helper resolving
  `auth.uid()` to a role. Needed specifically because `users` itself has
  RLS enabled with no policies (default-deny) — a plain lookup would be
  blocked by the very table it's checking, for the same non-privileged
  role the policy is trying to gate. Standard Supabase pattern for this.
- Four policies on `project_configurations` (select/insert/update/delete),
  all gated on `current_app_user_role() in ('pm', 'admin')` — matches D3
  ("PM/Admin only" ownership) for both read and write, nothing broader.

**Verified live with real rigor, not a service_role-bypass shortcut:**
created two actual `auth.users` rows (admin, member) with matching internal
`users` rows, then simulated exactly what PostgREST does at request time —
`set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`
inside a transaction, rolled back after each check. Confirmed: the member
role's `INSERT` was rejected by the RLS policy itself (not a permission
error elsewhere), the member role's `SELECT` returned 0 rows (RLS-filtered,
not an error), and the admin role's `INSERT` succeeded. Re-runnability
re-confirmed across all five migrations (0001–0005) from a dropped schema.

**Deliberately narrow scope, not expanded beyond what was asked:** no read
policies were added for any other table (they're still RLS-enabled,
zero-policy, default-deny for anon/authenticated — safe, just inaccessible
to non-service-role callers until a real need defines the policy). No
project-membership-based read policy was added to `project_configurations`
either, even though "can a project member at least read their own
project's config" is a reasonable future question — D3 says PM/Admin
*owns* config, and task 2.5 only asked to prove non-admins can't write it,
so broader read access wasn't invented here.

### 2.6 Seed and fixtures

- **Do:** a seed script creating one synthetic project with members, and fixture
  payloads (real shapes captured in Phase 0) for every source system.
- **Done when:** a fresh developer can go from clone to populated local DB in one
  command.

**Done — 2026-09-22.** `npm run db:setup` (= `migrate && seed`) is the one
command. Built a small idempotent migration runner
(`ai-pm-platform/db/migrate.ts`, not explicitly asked for but necessary —
without one, "one command" would mean a developer manually running 5 SQL
files in the right order) tracked via a `_migrations` table, plus
`ai-pm-platform/db/seed/seed.ts` which upserts one synthetic project
("Demo Project", code `DEMO`) with 4 members across the role spectrum
(admin, pm, developer, qa) on natural unique keys — safe to rerun.

**Verified live, not assumed:** dropped the entire schema (all 18 tables
plus the migration-tracking table and 3 trigger functions), ran
`npm run db:setup` once from that truly empty state — 5 migrations
applied, project seeded. Ran it a second time — 0 new migrations, same
project id returned (real idempotency, not just "didn't crash").

**Fixtures** (`ai-pm-platform/db/seed/fixtures/`, provenance documented in
that directory's own `README.md`, not duplicated here) — for task 3.1's
normalizer tests to run against, not inserted by the seed script:
- `jira-issue.json` — a **real, live-fetched** Jira issue (LT-43), then
  **anonymized**: it originally contained two real people's names and a
  real `@adpcx.com` email address, caught before committing (a Bash
  permission classifier flagged the initial inspection attempt as
  "Sensitive-Source Provenance," which was the right call). Replaced
  `accountId`/`displayName`/`emailAddress`/`avatarUrls` — including the
  ones embedded in `self` URL query strings, which a first-pass field-only
  replacement missed — with fixture placeholders. All structural content
  (field names, real status/issuetype IDs) is untouched.
- `requirements-app-item.json` — synthetic values, real field names/types
  (verified against project-compass's actual migrations).
- `github-pull-request.json`/`github-push.json` — synthetic, following
  GitHub's documented webhook shapes, **not live-fetched**: real API calls
  against `alldayPA/line-tester` returned 404 this session.
  **New finding, not resolved here:** GitHub org access has narrowed since
  Phase 0 — `docs/discovery.md` documented 431 visible repos including
  `line-tester`; only 3 repos are visible now and `line-tester` isn't one
  of them. Worth investigating before task 3.2 (Git ingestion) needs real
  webhook verification.
- `qa-run.json` — synthetic, matches our own `qa_runs` schema; no external
  QA system exists to capture a real payload from.

**One unrelated thing noticed, deliberately left alone:** while working,
`docs/event-contracts.md` and `project-compass/src/routeTree.gen.ts`
showed uncommitted changes I didn't make — real, in-progress work from
another session (a Jira webhook route added to project-compass, with a
note that a webhook subscription now exists but feeds project-compass
directly, not this platform's ingestion pipeline). Left both untouched and
uncommitted; not mine to stage or take credit for.

> ### Gate 2 — passed 2026-09-22
>
> Records can be created, related, and queried with no AI and no integrations.
> This matches the spec's own Phase 1 exit criteria. Verified end to end via
> `npm run db:setup` from a dropped schema.

---

# Phase 3 — Event ingestion

### 3.1 Shared normalizers

- **Do:** in `packages/core`, one pure normalizer per source turning a raw
  payload into the internal event shape from `docs/event-contracts.md`.
- **Check:** pure functions, no I/O — they must be trivially unit-testable
  against the Phase 0 fixtures.

**Done — 2026-09-22.** `ai-pm-platform/packages/core` (new workspace
member) with a shared `NormalizedEvent` type and three normalizers:
`normalizeJiraIssue`, `normalizeStakeholderItem`,
`normalizeGithubPush`/`normalizeGithubPullRequest`. 8 unit tests, all
passing, run against the actual task 2.6 fixtures (not invented sample
data) — including the real, anonymized LT-43 Jira issue.

**A design decision worth stating plainly:** `NormalizedEvent` has
`projectHint` where the `events` table has `project_id`. A normalizer
can't produce a resolved project uuid from a raw payload alone — that's a
database lookup, and task 3.3 explicitly separates "normalize" from
"resolve project" as two different pipeline steps. `projectHint` carries
whatever raw identifier the source gives (Jira project key,
`owner/repo`, or project-compass's own project uuid), and resolving it to
our internal `projects.id` happens later, in the ingest Worker.

**Jira and requirements-app normalizers don't infer what changed** (status
transition, reassignment, comment) — both sources are **polled**, not
pushed (confirmed live: zero Jira webhooks configured, and project-compass
emits none at all), so a "normalize" call only ever sees one snapshot.
Determining what actually changed requires diffing against previously-seen
state, which is a database read — explicitly out of bounds for a pure
normalizer per this task's own Check. That diffing is the ingest Worker's
job, not built here.

**GitHub normalizers are unverified against a live delivery.** Real API
calls against `alldayPA/line-tester` returned 404 this session (the org access
regression noted in task 2.6 — 431 repos documented in Phase 0, 3 visible
now). Built against GitHub's publicly documented webhook shape instead;
flagged in the normalizer's own file comment to re-verify field-for-field
before task 3.3 ships against it for real.

**QA normalizer deliberately not built.** There is no external QA system
to write a normalizer *for* — `docs/discovery.md` §0.4 confirms none
exists; the minimal QA form (task 4.5) is this data's actual origin, not
an external API with a payload to normalize. Building one now would mean
guessing a contract that doesn't exist yet (`CLAUDE.md` §3 rule 2).

### 3.2 Signature verification

- **Do:** per-source HMAC verification at the top of each ingest Worker, before
  any parsing or DB access.
- **Done when:** a test with a tampered body and a valid-looking header is
  rejected with 401 and writes nothing.

**Done — 2026-09-22, at the cryptographic-correctness level; the
Worker-level 401 response is task 3.3's job, not built yet.**
`ai-pm-platform/packages/core/src/security/hmac.ts`: `verifyWebhookSignature`,
one shared function for both sources — GitHub and Jira Cloud turned out to
use the **identical wire format** (`<method>=<hex digest>`), just under
different header names (`X-Hub-Signature-256` / `X-Hub-Signature`). Uses
Web Crypto (`crypto.subtle`), not `node:crypto`, since this code needs to
run in the eventual Cloudflare Workers runtime, not just Node.

**Real gap closed, not assumed:** Jira Cloud's webhook signature scheme
was completely unconfirmed anywhere in this project before today — fetched
Atlassian's own developer docs live (2026-09-22): HMAC-SHA256 since
February 2024, `X-Hub-Signature` header, `sha256=<hex>` format, "Jira
might start using another method for the HMAC in the future" (the parser
is written to reject any method it doesn't explicitly support, not
silently accept one). Atlassian's docs also publish a worked test vector
(secret `"It's a Secret to Everybody"`, payload `"Hello World!"`) —
**independently recomputed with `node:crypto` before trusting the fetched
page's transcription of it**, confirmed byte-for-byte identical, then used
as a real unit test. This proves the implementation is actually correct
against a third-party-published answer, not just internally
self-consistent with its own logic.

**16 tests, all passing**, including the task's own literal wording — a
tampered body against a valid-looking header is rejected — plus wrong
secret, missing header, malformed header, unsupported hash method, and
non-hex content, all rejected rather than throwing (an ingest Worker
should treat "can't verify" and "verification failed" identically: reject,
touch nothing, per `CLAUDE.md` hard rule 3).

**What's genuinely still open:** the task's literal "Done when" is about a
Worker returning **401** and **writing nothing to the database** — that
requires an actual ingest Worker, which doesn't exist until task 3.3. This
task proves the cryptographic primitive is correct; wiring it into a real
Worker that enforces it before any DB access is 3.3's job.

### 3.3 Ingest Workers

- **Do:** one Worker per source: verify → normalize → resolve project →
  **enqueue onto the events Cloudflare Queue** → return 2xx fast. The ingest
  Worker does **not** touch Postgres directly (revised 2026-09-18 — see
  `CLAUDE.md` §2, Cloudflare Queues are free-tier as of the date checked in
  `docs/constraints.md`).
- **Check:** resolve the project from configuration (Jira project key, repo
  name), and if it resolves to no configured project, record and drop — we only
  ingest configured projects (D24). Return 2xx even for ignored events so
  providers don't retry forever; log the ignore (dropped events never reach the
  queue at all).

**Done — 2026-09-22, for 2 of 3 sources; the third is genuinely blocked, not
skipped.** Real infrastructure, not just code: created the
`ai-pm-platform-events` Cloudflare Queue live (`wrangler queues create`).

- **`workers/ingest-git`** — a true webhook receiver, exactly as this task
  describes: verify (task 3.2's `verifyWebhookSignature`) → normalize →
  resolve project → enqueue → 2xx. Deployed and tested **live against the
  real deployed Worker**, not mocked: a ping event returns 200, an
  unconfigured repo resolves-to-null and returns 200 without reaching the
  queue (D24), a tampered body with a valid-looking signature returns 401
  (task 3.2's literal wording, now proven end to end through a real
  Worker, not just the crypto primitive), and a request with no signature
  header returns 401. Also proved the full success path for real: mapped
  the seeded Demo Project to `alldayPA/line-tester` temporarily, sent a
  signed push event, confirmed 200 with no exception, reverted the mapping
  after.
  **A real bug found and fixed via live testing, not caught by unit tests
  or local repro:** passing the bare `fetch` reference as `fetchImpl`
  caused `TypeError: Illegal invocation` in the deployed Worker (lost
  `this` binding) — Node has no such restriction, so this only surfaced by
  actually deploying and hitting the real endpoint, confirmed via
  `wrangler tail`. Fixed with an arrow-function wrapper; documented inline
  so the same mistake doesn't get repeated in `ingest-jira`.
- **`workers/ingest-jira`** — **not a webhook receiver**: real,
  live-verified fact is zero Jira webhooks configured (`docs/discovery.md`
  §0.2), so this polls instead, gated behind a shared trigger secret
  rather than task 3.2's HMAC (there's no inbound webhook to verify a
  signature on). **Deliberately claims no standalone cron trigger** —
  `docs/constraints.md`'s 5-cron-trigger-per-account budget is real and
  tight, and task 3.6 (Scheduler Worker) is where consolidation is
  designed to happen; this exposes its polling logic over HTTP instead,
  ready for 3.6 to call. Deployed and tested **live against the real
  Jira API**: temporarily mapped Demo Project to `LT`, triggered a poll
  with a 30-day window, got `{"enqueued":33}` back — real issues, really
  normalized, really queued, not a synthetic fixture.
- **`workers/ingest-requirements` — corrected and deployed 2026-09-23,
  same day as the note above claiming it was blocked.** The "no credential
  exists" claim was wrong — the human pointed out `project-compass/.env.local`
  already had `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, present since
  Phase 0 and simply never checked thoroughly enough at the time. Verified
  live before wiring anything up: the anon key genuinely does read
  `stakeholder_items` (a real `200`, not an RLS-blocked `403`).
  **This live check also surfaced two real, separate schema bugs, both
  corrected the same session, not left as known issues:**
  1. `jira_url`/`jira_key` don't exist on `stakeholder_items` anymore — a
     live query for them returned Postgres error `42703`. Migration
     `0008_multiple_jira_links.sql` in project-compass (predating this
     correction by months) had already moved them to a separate
     `stakeholder_item_jira_links` table. `docs/field-mapping.md` and
     `docs/discovery.md` still claimed the old scalar columns; both
     corrected, and the `StakeholderItem` type / fixture / Worker query all
     updated to match.
  2. **A real, shipped bug, not just a docs error:** `project_id` on
     `stakeholder_items` is a **text slug** (e.g. `"automated-mis"`), not a
     uuid — but `ai-pm-platform`'s own migration 0001 typed
     `projects.requirements_project_id` as `uuid`, on a never-actually-checked
     assumption. That column would have silently rejected every real
     project-compass id. Fixed via a new forward-only migration
     (`0006_fix_requirements_project_id_type.sql`, not an edit to the
     already-applied 0001), applied live through the real `npm run migrate`
     runner, and re-verified re-runnable from a fully dropped schema across
     all six migrations.

  With those fixed, deployed for real and tested against **live
  project-compass data**: an unauthorized request correctly returns 401;
  mapping Demo Project to the real `automated-mis` project-compass slug and
  polling with a wide window returned `{"enqueued":1}` — a real
  stakeholder item, really resolved, really queued. The specific live row
  content (a real client name and support-ticket reference) was
  deliberately not used in the committed fixture — only the verified real
  column shape was kept, with synthetic values.

**24 tests passing workspace-wide** (1 scaffold + 2 `ingest-requirements`
+ 21 `packages/core`, which now includes `project-resolution.ts` — a new
shared module resolving a normalizer's raw `projectHint` to our internal
`projects.id` via Supabase's REST API, since Cloudflare Workers don't
reliably support long-lived TCP sockets for a raw Postgres client;
`fetchImpl` is injected for testability rather than importing `fetch`
directly).

**All three ingest Workers for the sources currently in scope are now
deployed and live-verified against real systems** — `ingest-qa` remains
deliberately unbuilt (no QA system exists yet, same reasoning as the
deferred QA normalizer in task 3.1).

### 3.3b Event queue consumer

- **Goal:** decouple fast webhook acknowledgment from Postgres writes.
- **Do:** `workers/process-events`, a Queue consumer bound to the events queue.
  For each message (or batch): dedup on provider event ID → upsert `events` →
  update current-state tables → hand off to the Policy Engine (Phase 4, once
  it exists).
- **Check:** configure the queue's `max_retries` and retry delay explicitly —
  do not accept silent defaults. A message that exhausts retries routes to the
  DLQ (task 3.5), not to data loss.
- **Done when:** a consumer error (e.g. a malformed payload) causes the message
  to retry per the configured policy, not crash-loop the whole queue.

### 3.4 Idempotency and ordering

- **Do:** dedup on the provider event ID. Guard state updates against
  out-of-order delivery using source timestamps — an older event must not
  overwrite newer state.
- **Check:** duplicates can now come from **two independent sources** — the
  provider retrying its webhook, and Cloudflare Queues redelivering a message
  at-least-once. The dedup key and logic in `workers/process-events` must
  handle both without caring which one caused the repeat.
- **Done when:** replaying a captured event stream three times, and once
  shuffled, produces identical final state. This is the spec's Phase 3 exit
  criterion and the most important test in the project.

### 3.5 Failure handling — Dead Letter Queue

- **Do:** configure a **Dead Letter Queue (DLQ)** on the events queue for
  messages that exhaust `max_retries` (revised 2026-09-18 — this replaces the
  original hand-rolled "no Queues on the free plan" design; Queues are now
  free-tier, see `docs/constraints.md`). A small consumer Worker drains the DLQ
  into a `failed_events` table (error, attempt count, payload) so failures are
  visible in the Control Centre — queue contents aren't directly queryable.
- **Check:** the DLQ is the delivery-retry mechanism; `failed_events` is purely
  a **visibility** table fed by the DLQ drain, not a second retry loop. Do not
  build custom backoff logic that duplicates what the queue consumer config
  already does. Do not silently swallow a failure.

### 3.6 Scheduler Worker

- **Do:** cron-driven Worker for stale-work detection, Gemini assessment
  processing (Phase 6), the QA-rota exception check (4.4c), and (if needed
  from 1.2) a keep-alive ping to Supabase. Event _retries_ are now handled by
  the queue consumer's own retry policy (3.3b), not by this Worker — its job
  here is DLQ-drain scheduling and everything that isn't event-delivery retry.
- **Check:** stay within the free-plan cron trigger count from
  `docs/constraints.md` — **5 cron triggers per account**, confirmed
  2026-09-18. This is a genuinely tight budget across stale-detection, Gemini
  processing, DLQ drain, Supabase keep-alive, and the QA exception check —
  prefer one cron dispatching multiple jobs over many separate crons.

> ### Gate 3
>
> Events from every configured source land reliably, deduplicate, survive replay
> and reordering, and failures are visible rather than lost.

---

# Phase 4 — Deterministic automation

No AI in this phase. This is where most of the product value sits.

### 4.1 Policy Engine

- **Do:** `packages/policy` as pure functions: `(event, currentState, config) →
ProposedAction[]`. Encode the autonomy boundaries from spec §13 as rules —
  including the ones that forbid action.
- **Check:** the engine must be able to return "not permitted" with a reason.
  Never-automate list: developer assignment, active-sprint changes, approved
  requirement edits, release decisions, bug blocking.

### 4.2 Automation Engine

- **Do:** `packages/automation` — the only module that calls external APIs.
  Executes a permitted `ProposedAction`, records the result.
- **Check:** every outbound call needs an idempotency guard, because the same
  event may be evaluated twice. Before transitioning, re-read the issue's current
  status and skip if it's already in the target state.

### 4.3 Git ↔ Jira matching

- **Do:** ranked matcher per spec §11: explicit issue key > key in branch name >
  key in PR title > key in commit message > key in PR description > semantic
  match.
- **Check:** exact-identifier matches auto-link. Semantic matches must **only**
  produce a flagged suggestion for human confirmation — never a silent link
  (spec §11 is explicit about this). Keep semantic matching out of scope until
  Phase 6; ship the exact-signal tiers now.

### 4.4 The workflow rules

- **Do:** implement spec §12, each as an independently tested rule:
  - requirement ready → create Jira issue, persist requirement↔issue link
  - qualifying Jira comment **or** Git activity → In Progress (D6)
  - associated PR merged → Testing (D9)
  - entered Testing → auto-assign QA from the rota (see 4.4b) (D10)
  - QA PASS **with all four mandatory fields present** → Done (D11)
  - QA FAIL **with mandatory reason category** → Rework (D12)
  - Rework + new developer activity → In Progress again
- **Check:** "qualifying comment" is left open in the spec (D7) — define it
  concretely in `docs/discovery.md` and get human sign-off before coding it.
  PASS validation must be server-side and unbypassable.

### 4.4b QA assignment from the rota

- **Goal:** assign QA automatically, from a list only the human controls.
- **Do:** when an issue enters Testing, resolve the assignee in this order:
  1. an unconsumed per-issue override → use it, mark `consumed_at`
  2. `on_duty_user_id` if set and still an active project member
  3. the `selection_rule` applied over `eligible_user_ids`
     (`round_robin` uses `last_assigned_user_id`; `manual_only` assigns nothing)

  Write an `assignments` row with `assignment_type = 'qa'`, and an `action_log`
  row recording which branch of the above was taken and the rota's `updated_at`
  at the time.

- **Check:** read `CLAUDE.md` §3a and §8 before starting.
  - **Idempotency:** if the issue already has an active QA assignment, skip. The
    scheduler will re-evaluate this issue on later ticks and must not reassign.
  - **Never invent an assignee.** If the rota is empty, `paused`, every eligible
    person is inactive on the project, or the rule is `manual_only` — assign
    nothing, record the reason, and raise an exception (below). Do not fall back
    to the project lead, the last assignee, or anyone not on the list.
  - **No inference.** No skill matching, no workload balancing, no LLM. This rule
    is deterministic and belongs entirely in `packages/policy` +
    `packages/automation`.
- **Done when:** unit tests cover all four resolution branches plus every
  no-assignee case, and a replay test proves repeated evaluation of the same
  issue produces exactly one assignment.

### 4.4c Unassigned-QA exception surface

- **Goal:** issues must never sit silently in Testing with no QA.
- **Do:** a deterministic check (cron, per task 3.6) flagging any issue in
  Testing with no active QA assignment for longer than a configured threshold.
  Record it as an exception with the reason captured in 4.4b.
- **Check:** this is the failure mode that makes a human-curated rota risky — if
  you forget to update it, work stalls invisibly. The exception must be visible
  before Phase 8 exists; a queryable table plus a daily digest is enough for now.
- **Done when:** emptying a project's rota and merging a PR produces a visible
  exception rather than silence.

### 4.5 QA capture surface

- **Do:** if Phase 0 found no QA system with an API, build the minimal QA form on
  Pages writing to `qa_runs`, enforcing the four PASS fields and the FAIL reason
  categories (developer defect, requirement issue, requirement change,
  dependency, environment, test data, QA issue, other).

### 4.6 Integration tests

- **Do:** drive a synthetic project end to end from requirement through to Done
  and through a FAIL→rework→pass cycle, using fixtures and a mocked Jira.
- **Done when:** the full lifecycle passes with no AI involved.

> ### Gate 4
>
> The core workflow runs reliably with zero AI. **This is a shippable product on
> its own** — consider running it against one real low-risk project before
> continuing.

---

# Phase 5 — Safety and governance (pulled forward)

Do this before any AI or autonomy. The source spec puts it at Phase 11; that is
wrong for a solo operator with no on-call.

### 5.1 AI/automation action log

- **Do:** an append-only `action_log` table: trigger event, proposed action,
  policy verdict, executed y/n, external result, actor (`system`/`ai`/`user`),
  model and prompt version where relevant, and reversal status.
- **Done when:** every automated action in Phase 4 writes a row, and you can
  reconstruct why any ticket moved.

### 5.2 Global kill switch

- **Do:** a KV-backed flag checked by the Automation Engine before every
  outbound call, plus per-rule and per-project flags.
- **Done when:** flipping the global switch stops all execution within one
  request cycle while ingestion keeps recording events. Test this, don't assume.

### 5.3 Shadow mode

- **Do:** a mode where a rule evaluates and logs its intended action with full
  reasoning but does not execute.
- **Done when:** every rule can be independently set to `off | shadow | live`.

### 5.4 Observability

- **Do:** structured logging, an automation-failure surface, and counters for
  actions executed / blocked by policy / failed.
- **Check:** also track Gemini call health — pending assessment queue depth,
  API latency, error and rate-limit rates. A silent AI outage should be as
  visible as a failed automation.

> ### Gate 5
>
> Every action is attributable, reversible or overridable, observable, and
> stoppable. Shadow mode works.

---

# Phase 6 — AI requirement intelligence (shadow first)

### 6.1 Gemini client

- **Do:** `packages/llm` implementing the `assess()` contract in `CLAUDE.md` §5,
  targeting the Gemini API endpoint documented in task 0.7.
- **Check:**
  - Use Gemini's structured output mode (`response_mime_type: application/json`
    with `response_schema`) if task 0.7 confirmed it works on the free tier.
    Only fall back to prompt-and-parse if it genuinely doesn't.
  - Schema-validate every response regardless. On invalid output, route to human
    review — never retry-loop, and never let an unvalidated response reach the
    Policy Engine.
  - Explicit timeout per request. A slow Gemini call must not stall the
    scheduler Worker or burn through its CPU time limit.
  - On 429 (rate limit), back off and leave the assessment pending. Rate limits
    are assumed sufficient for our volume, so a 429 is unusual — log it as a
    warning, do not build complex rate-limit budgeting.
  - Handle Gemini being unreachable as a normal, expected condition: leave the
    assessment pending, log once per outage rather than per attempt.
  - Record the `model` field from the response, not from the request.
  - No second LLM provider. See `CLAUDE.md` §3 rule 10.
- **Done when:** a test sends a synthetic requirement and receives a
  schema-valid structured response, and a test with a mocked-down Gemini
  confirms the scheduler does not crash or block.

### 6.1b Assessment flow in the scheduler

- **Do:** the scheduler Worker (cron) picks pending assessments from the
  database, calls the Gemini client (6.1), validates, writes
  `requirement_assessments`, marks done.
- **Check:**
  - Gemini being down must show up as a growing pending backlog, never as a
    blocked Jira transition. Write a test that runs the Phase 4 lifecycle with
    Gemini mocked as unavailable — deterministic automation must be unaffected.
  - Process assessments one at a time per cron invocation rather than batching
    aggressively — a Worker has a CPU time ceiling and each Gemini call eats
    wall-clock time. If the pending queue is large, finish what you can and let
    the next cron tick pick up the rest.
  - Idempotency: if the assessment already exists for this version of the
    requirement, skip.

### 6.2 Context retrieval and PII redaction

- **Do:** build the retrieval bundle from spec §10: the requirement, relevant
  Twin state and history, PM Brain entries for that project, existing
  Epics/related work, dependencies, similar historical requirements. Run a PII
  stripping pass (names, emails, phone numbers) before building the prompt.
- **Check:** retrieve _relevant_ context, not the database. Set and enforce a
  token budget **against Gemini's actual context window from task 0.7**, not a
  guessed number, and leave headroom for the response. Log what was retrieved
  alongside each assessment so decisions are explainable later. The LLM client
  (6.1) must verify the redaction flag is present on the context bundle and
  refuse to send unredacted context.

### 6.3 Readiness assessment

- **Do:** structured output per spec §10 — decision (`READY`,
  `NEEDS_CLARIFICATION`, `POSSIBLE_DUPLICATE`, `HUMAN_REVIEW`), confidence,
  missing information, ambiguities, contradictions, related work, duplicate
  candidates, dependencies, scope concerns, reason. Persist to
  `requirement_assessments` with a version number. Re-run on requirement update.
- **Check:** confidence self-reported by the model is not well calibrated. Do
  not pick an auto-proceed threshold now — collect shadow data first. Google may
  silently update Flash mid-shadow-period; the `model` stamp per assessment lets
  you detect and segment this.

### 6.4 Shadow run and calibration

- **Do:** run in shadow over real requirements. Build a simple review screen
  comparing AI decision to what the human actually did.
- **Done when:** you have enough paired outcomes to propose an auto-proceed
  confidence band with evidence.
- **Ask if:** you are about to move this to `live` — that is a human decision
  (D2). Also confirm with the human that the specific projects being assessed
  are cleared for third-party data exposure per `CLAUDE.md` §2b.

> ### Gate 6
>
> Requirements are consistently routed with explainable evidence. Auto-proceed is
> still off unless a human enabled it with calibration data in hand.

---

# Phase 7 — PM Brain and Project Twin

**Deferred (human-confirmed 2026-09-18).** Do not start this phase until
Phases 1–5 have shipped and run against at least one real project —
requirements → Jira → Git → QA automation, deterministic, zero AI, is the
near-term goal. This phase (plus Phase 6's AI layer) waits until that's
proven out. This is a sequencing decision, not a scope cut — nothing here is
removed from the plan, just pushed later than originally ordered.

### 7.0 PM Brain tables (moved from the original task 2.3)

- **Do:** `pm_brain_entries`, `pm_brain_links`, plus a `vector` column for
  embeddings and an appropriate index. Migrate this in alongside 7.1, not
  earlier — no code depends on these tables existing before this phase
  starts.
- **Check:** `pm_brain_links` is the N↔N join to operational entities — it needs
  `entity_type` + `entity_id` + `relationship_type`, and no FK can enforce the
  polymorphic side, so validate `entity_type` against an allowed list.

### 7.1 PM Brain ingestion and retrieval

- **Do:** CRUD for the nine entry types (decisions, meeting notes, stakeholder
  context, risks, assumptions, hypotheses, discussions, lessons learned, project
  context), linking to operational entities, embeddings, and search by project +
  linked entity.
- **Check:** ingestion is user-controlled (D26). Do not auto-harvest context from
  anywhere. PM Brain holds context, never operational ticket state.

### 7.2 Twin state and timeline queries

- **Do:** current-state views across all four sources, plus the project event
  timeline.
- **Done when:** the system can answer "what is happening", "what changed since
  X", and "how are these entities connected" from the DB alone.

### 7.3 Contradiction and staleness detection

- **Do:** deterministic checks — Jira says Done but no PR merged; PR merged but
  ticket not in Testing; ticket In Progress with no Git activity for N days;
  issue with no requirement link; QA run with no evidence; issue in Testing with
  no QA assignment (promote the 4.4c check into this set).
- **Check:** these are rules, not LLM calls. Keep them deterministic and cheap.

---

# Phase 8 — PM Control Centre

### 8.1 Exception-first dashboard

- **Do:** Pages app with global and per-project views (D30), showing the D29
  priority order: Needs Attention, Critical Risks, Blockers, Decisions Required,
  What Changed, Project Status, Upcoming Deadlines, AI Recommendations.
- **Check:** surface exceptions, not every event. If the default view shows
  routine activity, the design has failed.

### 8.2 Evidence, overrides, and controls

- **Do:** every alert links to the events and records behind it. PM/Admin
  override UI. Automation failure and dead-letter queue surface. Kill switch and
  per-rule mode controls exposed in the UI.
- **Also:** move QA rota editing off Supabase Studio and into this UI — eligible
  list, on-duty selection, pause, and per-issue override. This is the point at
  which the interim control surface in `CLAUDE.md` §8 is retired.

### 8.3 Ask AI PM

- **Do:** a Q&A surface over Twin + PM Brain context.
- **Check:** read-only. It answers with citations to records; it never proposes
  an action that bypasses the Policy Engine.

---

# Backlog — do not start without explicit direction

Moved out of the critical path deliberately:

- Epic intelligence and auto-linking (D14), requirement decomposition (D15)
- Estimation calibration, AI-vs-lead-vs-actual comparison
- Semantic Git↔Jira matching beyond flagged suggestions
- Predictive: schedule risk, capacity, QA bottleneck, carry-forward, what-if
- Expanding autonomy beyond deterministic transitions
- Bug severity and blocking automation (D13 — explicitly deferred)
- `bugs` table and multi-project rollups

---

# Known risks to keep in view

| Risk                                                                   | Where it bites                                      | Mitigation already in the plan                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Guessed Jira transition IDs                                            | Silent mis-transitions in production                | Gate 0; task 0.2                                                                       |
| Webhook spoofing                                                       | Forged QA sign-off or ticket transition             | Task 3.2, verified before DB access                                                    |
| Duplicate webhook delivery                                             | Double Jira tickets, double transitions             | Tasks 2.4, 3.4                                                                         |
| Out-of-order delivery                                                  | Newer state overwritten by older event              | Task 3.4                                                                               |
| Queue message stuck failing / DLQ fills up unnoticed                   | Lost events on permanent failure                    | Task 3.5 DLQ + `failed_events` visibility table, drained by scheduler                  |
| Cron budget (5/account) too tight once Queues add DLQ-drain scheduling | A needed check silently loses its slot              | Task 3.6 — one cron dispatching multiple jobs, budget tracked in `docs/constraints.md` |
| Supabase inactivity pause                                              | Ingestion fails quietly                             | Tasks 1.2, 3.6                                                                         |
| Weak confidence calibration                                            | Bad auto-proceed decisions                          | Tasks 6.3, 6.4 — shadow mode, no threshold until paired data exists                    |
| Gemini free tier down or rate-limited                                  | AI assessments stall                                | Task 6.1b — backlog visible, deterministic automation provably unaffected              |
| Google silently updates Flash model                                    | Past assessments no longer comparable               | `model` from response stamped per assessment (task 6.1)                                |
| Free-tier data policy                                                  | Real requirement text and PM context seen by Google | `CLAUDE.md` §2b — PII stripping, per-project opt-in for NDA work                       |
| Free tier deprecated or repriced                                       | AI layer breaks with no notice                      | `packages/llm` abstraction allows provider swap; no second provider until needed       |
| Worker CPU ceiling hit during Gemini call                              | Scheduler Worker killed mid-request                 | Task 6.1b — one assessment per invocation, let next cron tick continue                 |
| Embedding dimension changed after data exists                          | Full re-embed of PM Brain                           | Task 0.7 settles the embedding model before task 7.0 (deferred with PM Brain)          |
| Free-tier terms change                                                 | Design built on a stale limit                       | Task 0.5, dated entries in `constraints.md`                                            |
| Solo operator, no on-call                                              | Automation misbehaves unnoticed for weeks           | Phase 5 pulled forward; Phase 8.2 failure surface                                      |
| Stale QA rota                                                          | Work stalls in Testing with no assignee, silently   | Task 4.4c exception check; rota `updated_at` in the action log                         |
| Override re-applied on every cron tick                                 | Same person reassigned repeatedly                   | `consumed_at` on the override row (task 2.2b)                                          |
| Single-QA project                                                      | Rota has no rotation and no cover                   | Flagged in task 0.4b before schema is built                                            |
| Scope creep back to 11 phases                                          | Never ships                                         | Backlog section; Gate 4 is a shippable product                                         |

---

# Session start checklist

1. Read `CLAUDE.md`.
2. Read `docs/discovery.md` — never re-guess something already verified there.
3. Find the first unchecked task in this file.
4. Confirm its phase gate has passed.
5. If the task needs a fact about an external system that isn't in `docs/`, stop
   and ask rather than inventing it.
