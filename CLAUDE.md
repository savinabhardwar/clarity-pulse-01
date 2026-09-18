# CLAUDE.md — AI PM Automation Platform

This file is your persistent context. Read it at the start of every session.
The ordered task list lives in `IMPLEMENTATION_PLAN.md`. The product spec lives in
`docs/AI_PM_Automation_Master_Implementation_Plan.docx` (converted to
`docs/spec.md` in task 0.1).

---

## 1. What we are building

An event-sourced integration platform that automates a project-management
workflow across four existing systems. It does **not** replace any of them.

```
Requirements App ─┐
Jira ─────────────┼──> Event Ingestion ──> Postgres ──> Policy Engine ──> Automation Engine ──> back into Jira/Git
Git ──────────────┤         (Workers)      (Supabase)     (rules)          (API calls)
QA ───────────────┘                             │
                                                ├── Project Twin  = current operational state + event history ("what is happening")
                                                └── PM Brain      = human-supplied context, decisions, risks ("why it matters")
                                                        │
                                                        └──> LLM reads both, returns STRUCTURED JSON recommendations only
```

**The single most important architectural rule:** the LLM never executes
anything. It returns a structured recommendation. The Policy Engine decides if
that recommendation is permitted. The Automation Engine executes it. Every
execution is logged. If you find yourself writing code where an LLM response
directly triggers a Jira mutation, stop — that is a design violation.

## 2. Target stack (zero cost, free tiers only)

| Layer | Tool | Notes |
|---|---|---|
| Database | Supabase (free project) | Postgres + pgvector + Row Level Security |
| Webhook ingestion | Cloudflare Workers | Free plan |
| Event queue | **Cloudflare Queues (free plan)** | Ingest Workers produce; a consumer Worker processes. See below |
| Scheduled jobs | Cloudflare Cron Triggers | Free plan — only **5 cron triggers/account**, budget carefully (see `docs/constraints.md`) |
| LLM | **Gemini 3.6 Flash (free tier)** | Google AI Studio API. See §2a. Switched from 3.8 Flash 2026-09-18 — see `docs/discovery.md` §0.7 |
| LLM fallback | **None** | If Gemini is down, queue and wait. Do not add a second provider |
| Embeddings | Gemini embedding model (free tier) or a lightweight open model via Supabase Edge Functions → pgvector | Confirm in task 0.7 |
| Feature flags / kill switch | Cloudflare KV | |
| UI (Control Centre) | Cloudflare Pages | |
| CI/CD | GitHub Actions + `wrangler deploy` | Personal repo |

**Revised 2026-09-18 — Cloudflare Queues are now free-tier** (10,000
operations/day, confirmed and dated in `docs/constraints.md` task 0.5; this
was not true when this plan was first written, and the original "do not use
Queues" instruction is now obsolete). Event ingestion uses Queues:

- Each `ingest-*` Worker's job shrinks to **verify signature → normalize →
  enqueue → return 2xx fast**. It does not touch Postgres directly.
- A separate **consumer Worker** (`workers/process-events`) reads off the
  queue, dedups on the provider event ID, upserts `events`, and updates
  current-state tables. This is the same decoupling the old "ingest vs.
  scheduler" split already had for Gemini — now applied to ingestion itself.
- The queue has a **Dead Letter Queue (DLQ)** configured for messages that
  exhaust their retry attempts. A small consumer drains the DLQ into the
  `failed_events` table (task 3.5) for human visibility — queue contents
  themselves aren't queryable from the Control Centre, so this table is
  still the visible surface, just fed by the DLQ instead of hand-rolled
  retry logic.
- **Queues do not replace idempotency.** They deliver **at-least-once** —
  see hard rule 4 below. Do not treat "it went through a queue" as a
  duplicate-safety guarantee.
- Durable Objects remain **out of scope** for this design even though the
  SQLite-backed flavor is now also free-tier — nothing here needs
  per-entity stateful coordination. Do not introduce them without a
  concrete need and a documented reason.

## 2a. Gemini integration — simplified architecture

Because Gemini is a hosted API reachable from the public internet, AI calls go
**directly from Cloudflare Workers** — no internal runner, no polling loop, no
split architecture. This is substantially simpler than a self-hosted model.

```
webhooks in ──> ingest Workers ──> Supabase
                                       │
                        scheduler Worker (cron)
                          │ reads pending assessments
                          │ calls Gemini API
                          │ validates response
                          │ writes assessment back to Supabase
                          ▼
                    automation Worker ──> Jira / Git APIs
```

Rules this imposes:

- **Gemini is a third-party API with no SLA on the free tier.** It can be slow,
  rate-limited, or down. Deterministic automation (Phase 4) must keep working
  with zero AI availability. Never block a Jira transition on the model being
  reachable. Pending assessments stay pending and surface as a visible backlog.
- **The Gemini API key is a secret.** It goes in `wrangler secret put`, never in
  code or config. Rotate it if it leaks; the free tier makes a new key trivial.
- **Free-tier terms may change.** Record the current terms (rate limits, data
  usage policy, model availability) in `docs/constraints.md` with the date
  checked. Do not build around a limit without verifying it first.
- **The scheduler Worker that calls Gemini is not the same Worker that processes
  webhooks.** Keep them separate so a slow or failing Gemini call never backs up
  event ingestion.

## 2b. Data policy — READ THIS

Google's free-tier API terms historically allow Google to use submitted data for
model improvement and to have humans review samples. **This means real
requirement text, PM Brain context, and customer detail may be seen by Google.**

The human has accepted this trade-off. However:

- Before enabling AI assessment on a project that is under NDA or client
  contract, **stop and confirm with the human** that this specific project's data
  is cleared for the Gemini free tier.
- Strip or redact PII (names, emails, phone numbers) from context before sending
  where possible. Build this into the retrieval pipeline, not as an afterthought.
- If the human later decides to move to a paid tier or self-hosted model to
  change the data posture, the `assess()` abstraction in §5 must make that a
  config change, not a rewrite.

**Free-tier limits change.** Do not hardcode assumptions about request caps,
row limits, cron counts, or model availability. When a limit matters to a design
decision, check current vendor docs and write what you found into
`docs/constraints.md` with the date you checked.

## 3. Hard rules

1. **Never commit secrets.** No API keys, tokens, connection strings, or webhook
   secrets in the repo — not in code, not in config, not in test fixtures, not
   in `wrangler.toml`. Use `wrangler secret put` and `.dev.vars` (gitignored).
   Add a secret-scanning pre-commit check in task 1.4.
2. **Never guess an external system's contract.** Jira status names, transition
   IDs, custom field IDs, webhook payload shapes, and the Requirements App API
   are all unknown until verified against the real instance. If you need one and
   don't have it, stop and ask. Do not invent a plausible-looking transition ID.
3. **Verify signatures before touching the database.** Every inbound webhook is
   untrusted until its HMAC is validated. A forged payload must not be able to
   transition a real ticket or sign off QA.
4. **Every write path must be idempotent.** Jira and GitHub retry webhooks, and
   Cloudflare Queues redeliver at-least-once on top of that. The same event
   delivered three times — whether by a raw webhook retry or a re-delivered
   queue message — must produce one row and one action. Queue delivery is not
   a substitute for deduping on the provider event ID.
5. **Deterministic before intelligent.** Do not add an LLM to any workflow step
   that can be expressed as a rule. The highest-value phases (3 and 4) contain
   no AI at all.
6. **Ship the kill switch early.** Safety infrastructure is Phase 5 here, not
   Phase 11 as in the original spec. This is a deliberate reordering — do not
   put it back.
7. **Shadow mode first.** Any new AI-driven or autonomous action logs its
   intended action without executing it, until a human reviews the log and
   explicitly enables it.
8. **Twin stays compact.** Store normalized rows, IDs, timestamps, and
   relationships. Keep a `source_reference` back to the origin system. Do not
   dump full webhook payloads into the state tables. (Raw payload may be kept on
   the immutable `events` row for traceability only.)
9. **Human-controlled actions stay human-controlled.** Never automate:
   developer assignment, active-sprint modification, changes to approved
   requirements, release decisions, or bug blocking. These are locked product
   decisions (D17, D18, D28), not preferences.
10. **Data leaves — treat it accordingly.** Gemini is a third-party hosted API.
    Real project data will reach Google's servers. This is accepted for most
    projects, but before enabling AI assessment on any NDA-covered or
    client-contracted project, stop and confirm with the human. Build PII
    stripping into the retrieval pipeline. If the human later moves to a
    self-hosted model, `packages/llm` must make that a config swap.
11. **People selection is always human-curated.** The system never decides *who*
    a person is for a role. Project Lead is configuration, set by the PM/Admin.
    QA assignment picks from a human-maintained rota (see §8) — the automation
    chooses *when* and *from a given list*, never *who is eligible*. Do not add
    skill inference, workload heuristics, or AI-driven people matching.

## 3a. Clarified interpretation of D10 (QA assignment)

The source spec says "automatic assignment with PM/Admin override," which is
ambiguous. The locked interpretation for this build is:

> **Automatic assignment from a human-curated rota.**

The human maintains, per project: who is eligible for QA, who is currently on
duty, and optionally a per-issue override. When an issue enters Testing, the
Automation Engine assigns from that rota deterministically. It does not decide
eligibility and does not wait for a human on each ticket.

This deliberately rejects the alternative reading — "human assigns each ticket
individually" — because that makes the PM a bottleneck on every issue, which is
the exact overhead the platform exists to remove.

Project Lead is *not* part of this. It is a configuration field
(`project_configurations.project_lead_id`), changed rarely, read directly. No
scheduled job reads it.

## 4. Repo layout

**Revised 2026-09-18.** This repo's root is not empty — it's already
`tanstack_start_ts`, a live TanStack Start app with its own `package.json`,
`vite.config`, `tsconfig.json`, and CI scripts. `CLAUDE.md`,
`IMPLEMENTATION_PLAN.md`, and `docs/` stay at repo root (Claude Code only
auto-loads a root-level `CLAUDE.md`, and the Phase 0 discovery work already
lives in root `docs/`). Everything else — the actual monorepo code — lives
under its own subdirectory, `ai-pm-platform/`, matching how every other app
in this repo (`project-compass/`, `team-pulse-54/`, `engineering-ethos/`) is
self-contained with its own `package.json` and tooling. Do not add `workers/`
or `packages/` at repo root — that would collide with the root app's own
build tooling.

```
/                                 # repo root — tanstack_start_ts app, pre-existing
├── CLAUDE.md
├── IMPLEMENTATION_PLAN.md
├── docs/
│   ├── spec.md                  # converted source spec
│   ├── discovery.md             # Phase 0 findings — the contract for everything else
│   ├── constraints.md           # verified free-tier limits, with dates
│   ├── field-mapping.md         # source system field → internal field
│   └── event-contracts.md       # normalized event schema per source
├── project-compass/              # existing app — Requirements App, see docs/discovery.md §0.3
├── team-pulse-54/                 # existing app — unrelated, own Supabase project
├── ai-pm-platform/                # NEW — everything for this project lives here
│   ├── package.json               # own workspace root, own tsconfig/lint/test config
│   ├── db/
│   │   ├── migrations/            # numbered, forward-only SQL
│   │   └── seed/
│   ├── workers/
│   │   ├── ingest-jira/           # verify sig → normalize → enqueue, no DB access
│   │   ├── ingest-git/
│   │   ├── ingest-requirements/
│   │   ├── ingest-qa/
│   │   ├── process-events/        # Queue consumer: dedup, upsert events, update Twin state
│   │   └── scheduler/             # cron-driven: policy eval, AI eval, stale detection, DLQ drain
│   ├── packages/
│   │   ├── core/                  # shared types, event schema, normalizers
│   │   ├── policy/                # Policy Engine — pure functions, heavily unit tested
│   │   ├── automation/            # Automation Engine — the only place that calls out
│   │   └── llm/                   # Gemini client, prompt templates, JSON schema validation
│   └── ui/                        # Cloudflare Pages Control Centre
└── .github/workflows/             # shared at root; ai-pm-platform's CI jobs scope to its path
```

## 5. LLM abstraction contract

All model calls go through one function in `packages/llm`. Nothing else in the
codebase imports a provider SDK.

```ts
assess<T>(opts: {
  task: string;              // named prompt template
  context: object;           // retrieved Twin + PM Brain context — never the whole DB
  schema: ZodSchema<T>;      // structured output contract
}): Promise<{ ok: true; data: T; model: string; latencyMs: number }
          | { ok: false; reason: 'invalid_json' | 'schema_fail' | 'provider_error' }>
```

Rules: validate every response against the schema server-side; on failure return
`ok: false` and route the item to human review rather than retrying blindly;
record the model name and prompt version on the assessment row so decisions stay
auditable when models change.

Gemini-specific notes:

- Use the **Gemini REST API** via `generativelanguage.googleapis.com`. Confirm
  the exact path and payload shape in task 0.7 — do not assume it hasn't changed
  since your training data.
- Prefer Gemini's **structured output / JSON mode** (`response_mime_type:
  application/json` with `response_schema`) if available on the free tier for
  this model. It is far more reliable than prompting for JSON and parsing. Check
  what the current API supports before writing a parser. **Known risk, verified
  2026-09-18:** live testing found `response_schema` requests failing with `503
  UNAVAILABLE` on 4/4 attempts, while plain (unstructured) `generateContent`
  calls to the same model succeeded reliably in between — see `docs/discovery.md`
  §0.7. Structured output may be more failure-prone than plain generation right
  now. The `assess()` implementation must handle this failure mode explicitly
  (treat 503 the same as any other `provider_error` — route to pending/human
  review, do not silently fall back to unstructured prompting as a workaround,
  since that reopens the unreliable-JSON-parsing problem structured output
  exists to avoid).
- Set an explicit request timeout. A slow Gemini call must not stall the
  scheduler Worker or burn through its CPU time limit.
- On 429, back off and leave the assessment pending. Rate limits are assumed
  sufficient for our volume — handle 429 as unusual, log it, do not build
  complex rate-limit budgeting or token counting.
- The model can change under you (Google may update Flash silently). Record
  `model` from the API response, not from your request, so the assessment row
  reflects what actually served the response.
- **PII stripping.** Before building the prompt, run the context through a
  redaction pass that removes names, emails, and phone numbers. This is part of
  the retrieval pipeline (task 6.2), not the LLM client, but the client must
  verify the redaction flag is present on the context bundle and refuse to send
  unredacted context.

## 6. Definition of done for any task

- Migrations run clean on a fresh database.
- Unit tests cover every state transition and policy rule you touched.
- Duplicate-delivery and out-of-order-delivery tests exist for anything on an
  event path.
- No secret in the diff.
- `docs/` updated if you learned anything about an external system.
- You have stated plainly what you verified versus what you assumed.

## 7. When to stop and ask the human

- A credential, webhook secret, or API token is needed.
- An external system's real configuration is needed and undocumented.
- A task requires a paid tier to proceed.
- You are about to enable a previously shadow-mode action for real execution.
- You are about to enable AI assessment on a project under NDA or client
  contract — data will reach Google.
- The spec contradicts itself, or a locked decision (D1–D30) conflicts with what
  the real systems actually allow.

Do not work around a blocker by inventing the missing fact.

## 8. Human control surface (QA rota and project config)

The human needs to set QA eligibility and duty without waiting for the Phase 8
Control Centre to exist. The interim surface is **Supabase Studio's built-in
table editor** — zero build, zero cost, editable from a phone. Do not build a
custom admin UI for this before Phase 8.

Design constraints for the rota:

- One row per project. Eligible QA users, a current on-duty selection, and an
  optional per-issue override live here.
- Overrides are consumed, not persistent — once applied to an issue, the
  automation must not keep re-applying them on later cron ticks.
- The rota is read by the scheduler/automation path on each evaluation. It is
  plain config, not an event source; edits do not need to emit events, but
  changes should be timestamped so the action log can explain past assignments.
- An empty or fully-unavailable rota is an **exception**, not a silent no-op.
  Issues waiting in Testing with no assignable QA must surface. See task 4.4c.
- Assignment must be idempotent: check for an existing active QA assignment on
  the issue and skip rather than reassigning on every tick.

A version-controlled JSON file in the repo is the acceptable alternative if the
human prefers git auditability, but it requires a deploy per change. Default to
Supabase unless told otherwise.
