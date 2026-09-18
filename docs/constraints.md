# constraints.md — Verified free-tier limits

Per `CLAUDE.md` §2: do not hardcode assumptions about request caps, row
limits, cron counts, or model availability. Every entry below must be sourced
from current vendor documentation and dated. See `IMPLEMENTATION_PLAN.md` task
0.5.

---

## Supabase free project

### Database size limit

**500 MB** database (shared CPU, 500 MB RAM). Checked 2026-09-18.
Source: [Supabase Pricing](https://supabase.com/pricing).

### Inactivity pause behaviour and window

Free projects **pause automatically after one week (7 days) with no API
activity**. Data is retained while paused; the project must be manually
resumed. Only **2 active free projects** are allowed at once per
organization — additional projects must stay paused. This directly affects
task 1.2/3.6: the scheduler Worker's cron needs a lightweight keep-alive
ping (any authenticated API call) at an interval well under 7 days, or the
project will go offline and ingestion will fail silently until resumed.
Checked 2026-09-18. Source: [Supabase Pricing](https://supabase.com/pricing).

### Row Level Security notes relevant to this project

Not separately limited by the free plan — RLS is a Postgres/Supabase feature
available on all tiers, no free-tier restriction found. (No dedicated
"RLS limit" exists in the pricing docs; this line is here to record that
absence explicitly rather than leave it unchecked.)

### Other relevant limits

- **1 GB** file storage (Supabase Storage).
- **500,000** Edge Function invocations/month.
- **200** concurrent Realtime connections (peak), **2,000,000** Realtime
  messages/month, 256 KB max message size.
- **50,000** monthly active users (Auth) — not relevant to this project's
  service-role usage pattern, noted for completeness.

Checked 2026-09-18. Source: [Supabase Pricing](https://supabase.com/pricing).

---

## Cloudflare Workers (free plan)

### Requests per day

**100,000 requests/day**, resets at midnight UTC. Exceeding it returns error
1027 (requests rejected, not billed). Checked 2026-09-18. Source:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### CPU time per invocation

**10 ms** CPU time per invocation on the Free plan (wall-clock/I-O-wait time
is not counted, only active CPU time). Cloudflare's own docs note the
average Worker uses ~2.2 ms/request, but this is workload-dependent — a
Gemini call's _network wait_ doesn't count against this, but any JSON
parsing/validation work around it does. This is why task 6.1b processes one
Gemini assessment per cron invocation rather than batching. Checked
2026-09-18. Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Cron trigger count

**5 Cron Triggers per account** on the Free plan (vs. 250 on Paid). This
confirms task 3.6's instruction to prefer one cron dispatching multiple jobs
over many separate crons — 5 is a real, tight ceiling across the whole
project (ingestion retries, stale-work detection, Supabase keep-alive,
Gemini assessment processing, QA-rota exception check all have to share
this budget). Checked 2026-09-18. Source:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Workers AI allocation (model availability, request limits)

**Not applicable — out of scope.** CLAUDE.md was updated to use the Gemini
API directly (§2/§2a) instead of Cloudflare Workers AI; no Workers AI
binding is used anywhere in this design, so its limits were not researched.

### KV operations (reads/writes/deletes per day)

Free plan: **100,000 reads/day**, **1,000 writes/day** (to distinct keys;
writes to the _same_ key are further limited to 1/second, shared with paid
plans), **1 GB** total storage per account/namespace, 25 MiB max value size.
This is the binding constraint on the kill-switch design (task 5.2) — a
naive "check KV on every request" pattern is fine for reads (100K/day is
generous relative to Worker request volume) but per-project/per-rule flags
that get toggled frequently must not write on every check, only on actual
flag changes. Checked 2026-09-18. Source:
[Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/).

### Cloudflare Pages limits

Not independently re-verified this session beyond what's implied by the
Workers Free plan (Pages Functions share the Workers free-plan request/CPU
limits per Cloudflare's unified pricing). No Pages-specific numeric limit
(builds/month, bandwidth) was pulled — flagged as **not found in current
docs during this pass — needs manual verification** before Phase 8 UI work
relies on a specific Pages quota.

---

## Explicitly confirmed exclusions

### Cloudflare Queues — confirmed paid-only? (date checked)

**No longer true — CLAUDE.md's assumption is outdated. Flagging to the
human per task 0.5's explicit check.** As of 2026-09-18, Cloudflare Queues
**are available on the Workers Free plan**: 10,000 operations/day (1,000,000
operations/month) included, per Cloudflare's own pricing page. This
contradicts `CLAUDE.md` §2's "Do not use Cloudflare Queues... They are not
on the free plan" — that constraint has since changed. **This is worth a
design conversation**, since Queues would materially simplify the
"idempotent upserts instead of queueing" pattern the whole ingestion design
(`failed_events` table, task 3.5) is built around. Not changing the design
unilaterally here — recording the fact and flagging it per `CLAUDE.md` §7
("free-tier limits change... tell the human"). Source:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

### Durable Objects — confirmed paid-only? (date checked)

**Also changed.** As of 2026-09-18, Durable Objects **with the SQLite
storage backend are available on the Workers Free plan** (the legacy
key-value storage backend still requires the Paid plan). Same flag as
Queues above — CLAUDE.md's "not on the free plan" blanket statement is now
only half-true (true for the KV-backed flavor, false for SQLite-backed).
Source: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

---

## Gemini free tier (Gemini 3.8 Flash)

**Model name confirmed current** — "Gemini 3.8 Flash" is a real, currently
listed model in Google's Gemini API docs as of 2026-09-18 (not a stale or
invented name); see [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Rate limits (RPM / RPD / TPM)

**Partially found, and worth a red flag.** Google's own rate-limits page
does not publish static per-model numbers — it says limits depend on
account usage tier and directs you to check the live value in [Google AI
Studio](https://aistudio.google.com/rate-limit?timeRange=last-28-days),
which requires an actual account/key to view (task 0.7, not done yet).
Third-party sources (a Google AI Developers forum thread, dated around this
period) report the free tier for Gemini 3.8 Flash specifically at **~20
requests/day (RPD)** — notably lower than older Flash models, and low
enough that `IMPLEMENTATION_PLAN.md`'s assumption ("Gemini rate limits are
assumed more than sufficient for our volume") **should be re-checked once a
real key is available (task 0.7)** rather than left as an assumption. This
number is **not from an official Google doc** (the official page has no
static table for this) — treat 20 RPD as a plausible-but-unverified data
point, not a sourced fact, until task 0.7 confirms it against a real
account. Flagging per `CLAUDE.md` §7: if 20 RPD is accurate, it is likely
**not** sufficient for any real project volume, and the whole "assumed
sufficient" premise in task 0.5/6.1 needs revisiting with the human before
Phase 6 is built.

### Data handling policy

**Confirmed via official pricing page, checked 2026-09-18:** on the free
tier, Google's pricing docs mark data usage as **"Yes" — content is used to
improve Google's products** (consistent with `CLAUDE.md` §2b's documented
trade-off). On the paid tier, the same page marks data usage as **"No"**.
Source: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Embeddings

Not checked this pass — deferred to task 0.7, which already owns
confirming whether a free-tier Gemini embedding model exists, its
dimensionality, and its rate limits.

---

## LLM fallback providers (Groq / OpenRouter)

**Intentionally not researched.** `CLAUDE.md` §2/§3 rule 10 explicitly
rules out a second LLM provider ("If Gemini is down, queue and wait. Do not
add a second provider") — there is nothing to source here unless that
decision changes.

---

## Change log

| Date checked | What changed                                                                                                                                                                                                                   | Source                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-18   | Supabase free plan: 500 MB DB, 7-day inactivity pause, 2 active project cap, storage/edge-function/realtime limits recorded                                                                                                    | [Supabase Pricing](https://supabase.com/pricing)                                                                                      |
| 2026-09-18   | Cloudflare Workers free plan: 100K req/day, 10ms CPU/invocation, 5 cron triggers/account                                                                                                                                       | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)                                                          |
| 2026-09-18   | Workers KV free plan: 100K reads/day, 1K writes/day, 1GB storage                                                                                                                                                               | [KV limits](https://developers.cloudflare.com/kv/platform/limits/)                                                                    |
| 2026-09-18   | **Cloudflare Queues now available on Free plan** (10K ops/day) — contradicts CLAUDE.md §2's "not on the free plan" assumption; flagged for human decision                                                                      | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)                                                        |
| 2026-09-18   | **Durable Objects (SQLite-backed) now available on Free plan** — same CLAUDE.md contradiction as Queues, partially                                                                                                             | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)                                                        |
| 2026-09-18   | Gemini 3.8 Flash confirmed as a real current model; free tier marked "data used to improve products"; RPD figure (~20/day) found only in an unofficial forum source, not Google's own docs — needs re-verification in task 0.7 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
