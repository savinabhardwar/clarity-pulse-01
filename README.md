# ClarityPulse

Engineering dashboards for people, capacity, delivery, and team health.
Project Compass is a separate application and Git repository at
`../project-compass/` in the local workspace.

```text
frontend/             Team Pulse React / TanStack Start interface
backend/app/          Python / FastAPI dashboard API
backend/tests/        Dashboard and scheduled-job tests
backend/app/jobs/     Python Jira sync and release-note jobs
backend/automation/   Python FastAPI ingestion / Cloudflare Queue workers
supabase/migrations/  Existing database schema, views and RPCs
```

## Run locally

Use Node.js 22 and Python 3.10 or newer. From the repository root:

```sh
npm ci
cd frontend
node ../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174
```

The npm workspace delegates frontend commands to `frontend/`. Set the frontend
server's `CLARITY_BACKEND_URL` in `frontend/.env.local`, using `.env.example`
as a guide. The default Python service URL is `http://127.0.0.1:8001`.

In a second terminal, from `backend/`:

```sh
python -m venv .venv
# Activate .venv using your shell, then:
python -m pip install -e .
python -m uvicorn app.main:app --reload --port 8001
```

Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `backend/.env.local` or the
backend deployment environment. Settings load this file independently of the
working directory, and environment variables take precedence. The API uses
the existing anon role and database policies. `/api/health` checks process
liveness; `/docs` exposes the API contract. No new login is introduced.

## Migration boundary

The frontend now comes from `../team-pulse-54/`: Dashboard, People, Projects,
Planning, Next Sprint, and Trends. Its engineering calculations and visual
design are retained. The source repository stays separate and unchanged.

All dashboard reads now go through Python: people and historical snapshots,
person/project details, allocations, contributors, organization metrics,
standouts, blockers, ticket hygiene, activity, risks, teams and sprint counts.
The existing database views and RPC calculations are preserved. React Query
still owns browser caching and the UI keeps its existing data shapes.

Team Pulse's sprint tickets, worklogs, availability, history, and sprint
summary queries also use Python. Planning availability supports add, edit,
and delete through validated FastAPI endpoints using the existing anon role.

The frontend's `/api/clarity/*` adapter transports these fixed routes to Python. It
does not expose arbitrary Supabase tables or RPC calls. Supabase credentials
and the SDK have been removed from the frontend. The new page URLs are
`/`, `/people`, `/projects`, `/planning`, `/next-sprint`, and `/trends`.

The Next Sprint sync button dispatches the existing GitHub Jira workflow via
Python. Configure optional `GITHUB_ACTIONS_TOKEN` and `GITHUB_ACTIONS_REF`
(default `main`) in the backend environment. Until configured, it reports
that the sync trigger is unavailable. Scheduled Jira sync remains independent.
No workflow was dispatched while verifying this replacement.

Jira sync and release-note jobs stay in this repository under
`backend/app/jobs/`. Both run in Python. Jira cache and generated files remain
under ignored `backend/jobs/jira-sync/` to preserve local data during the move.
The GitHub Actions jobs now install the Python backend and use these entrypoints.

Put dashboard and scheduled-job credentials in ignored `backend/.env.local`.
From `backend/`, deliberate job runs are:

```sh
python -m app.jobs.jira_sync.runner --incremental
python -m app.jobs.jira_sync.runner --full
python -m app.jobs.release_notes.runner --dry-run
```

The Jira commands write to the configured database. A release run without
`--dry-run` publishes to Confluence and advances its schedule. Verification
uses fixture providers and disposable database schemas.

## Event automation

The existing AI PM subsystem is now `backend/automation/`, with Python source
in `src/ai_pm/`, forward SQL migrations in `db/migrations/`, and worker configs
at its root. All four ingestion/health workers use FastAPI; the fifth uses
Cloudflare's Python Queue entrypoint. The existing worker names, queues, KV
namespace and trigger/signature contracts are preserved. Node.js is needed
only for the Cloudflare CLI and the frontend.

Use Python 3.13 or newer and install uv. From `backend/automation/`:

```sh
npm ci
uv sync --locked
uv run python -m unittest discover -s tests -v
uv run pywrangler dev --config wrangler.hello-world.jsonc --port 8787
```

Other configs are `wrangler.ingest-git.jsonc`, `wrangler.ingest-jira.jsonc`,
`wrangler.ingest-requirements.jsonc` and `wrangler.process-events.jsonc`.
Keep the configs at this project root so the worker SDK and vendored packages
resolve correctly. Cloudflare loads secrets from bindings; a local ASGI server
can use `uv run uvicorn ai_pm.local:app --port 8002`.

Automation credentials belong in its own ignored `.env.local`, guided by
`backend/automation/.env.example`. Compass polling has separate
`REQUIREMENTS_APP_SUPABASE_URL` / `REQUIREMENTS_APP_SUPABASE_KEY` settings.
Do not infer automation's database target from the dashboard environment:
the two schemas contain different `projects` tables. No automation production
credentials were available to verify its deployment in this checkout.

Before deploying the event consumer, apply migration `0007` to the automation
database. It atomically persists the event log and compact state so a failed
state update can be retried. Database setup commands require the optional
PostgreSQL dependency and use only automation's `DATABASE_URL`:

```sh
uv sync --extra database
uv run python -m ai_pm.database migrate
uv run python -m ai_pm.database seed
```

The seed creates a synthetic DEMO project and four members; it does not create
login passwords. The existing CI deployment remains limited to hello-world.
The policy engine, AI recommendations and future UI remain planned work in
`IMPLEMENTATION_PLAN.md`; this refactor ports the implemented backend.

## Verify

From the root:

```sh
npm run build
npm run lint
npm run typecheck
npm test
npm run test --workspace frontend
```

From `backend/`:

```sh
python -m unittest discover -s tests -v
```

Live read-only query parity and browser checks are documented in
[docs/refactor-testing.md](docs/refactor-testing.md).

## Deployment

Deploy Python as a separate service and set `CLARITY_BACKEND_URL` in the
frontend server's deployment environment before publishing the frontend.
The local default URL will not reach your Python service from a remote host.
The root build command remains `npm run build`.

Nitro's default Cloudflare output is under `frontend/.output/`. The Netlify
configuration publishes `frontend/dist`, with its server functions emitted
at the repository root under `.netlify/functions-internal/`. Neither target
was deployed as part of this refactor. No production migrations were applied and no
scheduled jobs or webhook registrations were changed remotely.

This project remains connected to [Lovable](https://lovable.dev). Root Git
and Lovable metadata are preserved. Lovable editor compatibility with the
workspace layout remains unverified; do not rewrite published Git history.
