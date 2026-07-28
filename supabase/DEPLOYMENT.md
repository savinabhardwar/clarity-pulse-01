# Deploying the Jira-backed Supabase pipeline

This backend was built and verified against a local Postgres 16 instance
(no live Supabase project was reachable from the build environment — see
"Why local verification" below). Everything here has been tested against
real Jira data end-to-end on that local database; the steps below are
what's left to point it at your actual Supabase project.

## 1. Run the migrations

In the Supabase SQL editor (or via `supabase db push` / `psql` against
your project's connection string), run every file in
`supabase/migrations/` **in filename order** (0001, 0002, ... 0010).
They're plain SQL, no Supabase CLI project scaffolding required.

## 2. Secrets

Two different credential sets are needed, for two different consumers:

| Secret | Used by | Where it lives | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend (`src/supabase.ts`) | `.env.local` (already present in your Lovable project) | Safe to be public — ships in the browser bundle. |
| `VITE_SUPABASE_ANON_KEY` | Frontend | `.env.local` | Safe to be public — RLS restricts it to read-only (see migration 0008). |
| `JIRA_BASE_URL` | Sync script (GitHub Actions) | GitHub repo secret | e.g. `https://alldaypa.atlassian.net` |
| `JIRA_EMAIL` | Sync script | GitHub repo secret | The Jira account the API token belongs to. |
| `JIRA_API_TOKEN` | Sync script | GitHub repo secret | Create at https://id.atlassian.com/manage-profile/security/api-tokens — MCP tools (used to build/verify this pipeline interactively) do **not** work inside a GitHub Actions runner, so the production sync script talks to Jira's REST API directly with this token. |
| `SUPABASE_DB_URL` | Sync script | GitHub repo secret | **Not** the anon key or the service_role JWT — this is the direct Postgres connection string from Supabase Dashboard → Project Settings → Database → Connection string (the "Session pooler" or "Transaction pooler" URI, with the database password filled in). The sync script uses `pg` for direct bulk upserts rather than going through PostgREST, which avoids PostgREST's per-request row/payload limits for a batch job of this size. |

Add the four GitHub secrets at: repo → Settings → Secrets and variables →
Actions → New repository secret.

## 3. First run

The GitHub Actions workflow (`.github/workflows/jira-sync.yml`) runs
hourly and can also be triggered manually (Actions tab → "Jira sync" →
"Run workflow"). For the very first run, trigger it manually with
`sync_type: full` — this re-derives the epic→project clustering and
guessed team roster fresh, and seeds `history` with the most recent 500
resolved tickets (the full lifetime backfill, currently ~3,000 tickets on
this Jira instance, completes incrementally over subsequent `full` runs
or by extending `fetch-jira-rest.mjs`'s history pagination — see the
comment in that file).

After the first run, leave it on the hourly `incremental` schedule.
Incremental runs only fetch tickets updated/resolved since the last
successful sync's watermark (stored in the `sync_runs` table), so they're
fast and cheap.

## 4. Verify

```sql
select * from sync_runs order by started_at desc limit 5;
select * from v_org_metrics;
select count(*) from tickets;
```

If `sync_runs.status = 'failed'`, check `error_message` on that row.

## 5. Team roster and project names need a human pass

Two tables were auto-derived and are **expected to need correction**,
not bugs. Both corrections are verified to survive a re-sync (tested
locally: made a correction, re-ran `sync.mjs`, confirmed it stuck):

- `people.team_guessed = true` for everyone initially — Jira has no team
  field, so the sync guesses each person's team from whichever Jira
  project they have the most tickets in this sprint. Correct real team
  assignments with:
  ```sql
  update people set team_id = '<real team uuid>', team_guessed = false,
    team_guess_reason = 'Confirmed by <who>' where id = '<person uuid>';
  ```
  `sync.mjs` checks `team_guessed = false` before touching `team_id` on
  every subsequent sync and will not overwrite it.
- `projects.name`/`projects.slug` come from auto-clustering epic names by
  similarity (`scripts/jira-sync/cluster-epics.mjs`, re-run fresh on every
  sync). Correct a wrong grouping via:
  ```sql
  insert into project_overrides (epic_jira_key, forced_project_slug, note)
  values ('TEAM-171', 'agent-assist', 'Belongs with Agent Assist, not its own project');
  ```
  `sync.mjs` reads `project_overrides` and re-applies it on top of the
  fresh auto-clustering every run, so it survives indefinitely. The
  target `forced_project_slug` must already exist as a project (i.e. you
  can redirect an epic into an *existing* project, not invent a brand new
  one this way) — check `select slug, name from projects` for valid
  targets. An override for an epic that hasn't been synced yet will fail
  its foreign key; add the override after the epic first appears.

## Why local verification

The sandbox this backend was built in has no general internet egress —
direct requests to `supabase.co` and `netlify.com` both return 403 at the
network proxy, and no Supabase MCP connector was available either. Every
piece of this backend (schema, sync transform logic, RPC functions) was
instead verified against a local Postgres 16 instance using the real Jira
data already pulled into this session, which is a faithful stand-in since
Supabase Postgres is, underneath, plain Postgres. The one thing that
genuinely cannot be verified from outside a real deployment is the GitHub
Actions workflow itself (network access, secret wiring) — test that with
a manual `workflow_dispatch` run before trusting the hourly schedule.
