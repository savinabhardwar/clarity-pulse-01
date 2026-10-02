# ClarityPulse refactor verification

Verified locally on 2026-10-02. All implemented backend code is Python.
The original React interface remains under `frontend/`.

- 75 dashboard and scheduled-job tests pass. These cover all dashboard routes,
  validation, upstream failures, Jira pagination and retries, account merging,
  transaction ordering, human corrections, cleanup gates, snapshots, narratives,
  release formatting, Confluence publication/deduplication, Gemini quota/model
  fallbacks and dry-run behavior.
- 18 automation tests pass, covering every HTTP route, signatures and trigger
  secrets, polling pagination/scoping, normalization, atomic RPC responses,
  batch acknowledgement/retry and SDK HTTP/Queue adapters.
- Legacy outputs were captured before removing JavaScript backend source.
  Checked-in fixtures retain their inputs: 60 metrics cases, 60 closed-sprint
  scoring cases, nine health/activity narratives, 17 epics, title/planning
  transformations, release formatting/prompts and nine provider-normalization
  cases. Tests require Python only and do not silently skip parity checks.
- Frontend build, TypeScript check and lint pass. Lint retains seven existing
  React Fast Refresh warnings. Both Cloudflare and Netlify builds were checked
  during the refactor.
- Live dashboard API results match the original Supabase view/RPC queries,
  including historical reads, allocations, details and exact counts.
- Chromium loads Overview, People, Projects, Resource Planning and Team Health,
  plus person/project details. No uncaught browser errors, failed dashboard
  API responses or direct browser-to-Supabase requests were found.
- The frontend proxy rejects unsupported mutation methods with 405 and unknown
  table/RPC paths with 404. Supabase credentials are backend-only.
- All five Python workers load in local Cloudflare workerd. Four HTTP workers
  pass health, OpenAPI, route/method and authentication checks. Git, Jira and
  Compass ingestion successfully use SDK HTTP transport and send to local
  Queue bindings with entirely local provider fixtures. The queue-only worker
  passes module loading; batch behavior is tested separately with injected
  messages, and persistence is checked against PostgreSQL.

Saved reports:

- [live-refactor-results.json](live-refactor-results.json): dashboard/API/browser parity.
- [job-migration-results.json](job-migration-results.json): Jira job database integration.
- [automation-database-results.json](automation-database-results.json): migrations,
  synthetic seed, event-state persistence, duplicates, rollback/retry and RPC access.
- [python-worker-results.json](python-worker-results.json): actual local worker runtime checks.

No production application rows were written, production pipelines run,
Confluence pages published, webhook registrations changed, production migrations
applied or remote deployments performed during validation. Database integration
checks created disposable schemas, inserted fixture rows, and removed their schemas.
The scheduled workflows now invoke Python; their execution on GitHub remains unverified.

## Repeat offline checks

From the repository root, after installing `backend/` in your Python environment:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

From `backend/automation/`, use Python 3.13+, uv and Node 22 for Wrangler:

```sh
npm ci
uv sync --locked
uv run python -m unittest discover -s tests -v
uv run python tests/smoke_workers.py --report ../../docs/python-worker-results.json
```

The worker check starts and stops local processes, uses test credentials and
local provider/queue fixtures, and does not contact production providers.
On Windows it stops only its own test process trees.

## Repeat live dashboard checks

Start the Python backend on port 8001 and frontend on port 5174. From `backend/`:

```sh
python -m pip install -e ".[smoke]"
python -m playwright install chromium
python scripts/smoke_live.py --report ../docs/live-refactor-results.json
```

This reads the backend's Supabase configuration and compares application API
results with the original direct queries. Use `--frontend-url` for another port.

## Repeat database integration checks

From `backend/`, with the configured database connection:

```sh
python scripts/smoke_job_database.py --report ../docs/job-migration-results.json
python scripts/smoke_automation_database.py --report ../docs/automation-database-results.json
```

Jira fixture tables copy deployed types, constraints and indexes. Public audit
triggers and most foreign keys are not copied; two cascading derived-table
relationships are restored. Narrative fixture views use isolated tables only.
Automation checks apply all seven migrations in a disposable schema on the
available dashboard database. They retarget the role-lookup function's public
search path only in that fixture. They also verify repeat migrations and seeds,
failed migration rollback, deduplication, state rollback/retry and service-role
RPC permissions. This does not establish the automation production database's
configuration or deployed migration state.

Before deploying the new consumer, migration 0007 must be applied to its actual
automation database. The API's local mock-provider tests cannot verify current
production GitHub permissions, Jira/Confluence credentials, Gemini availability,
Cloudflare bindings or Lovable editor compatibility. Captured GitHub fixtures
remain synthetic provider-shape examples; a real organization webhook delivery
has not been verified in this checkout.

Original source remains recoverable in Git history and the ignored local archive
`backend/.tools/legacy-backend/`. It is excluded from builds and commits.
