# Fixtures — provenance

Per `IMPLEMENTATION_PLAN.md` task 2.6 and `CLAUDE.md` §3 rule 2 (never
guess an external system's contract): each fixture below states plainly
what's real vs. synthetic. None of these are inserted by the seed script —
they exist for task 3.1's normalizer unit tests to run against.

| File | Provenance |
| --- | --- |
| `jira-issue.json` | **Real, live-fetched** (LT-43, 2026-09-22) via the real Jira REST API, then **anonymized**: real `accountId`/`displayName`/`emailAddress`/`avatarUrls` values (two real people, including a real `@adpcx.com` email) were replaced with `fixture-account-N` placeholders before this was committed — see the anonymization note this produced in `IMPLEMENTATION_PLAN.md` task 2.6. All field names, status IDs, issue type IDs, and structure are real and unmodified. |
| `github-pull-request.json`, `github-push.json` | **Synthetic**, following GitHub's publicly documented webhook payload shapes (standard product behavior, not org-specific — same treatment `docs/event-contracts.md` already gives GitHub's event catalog). **Not** live-fetched: real API calls against `alldayPA/line-tester` returned 404 this session — org access has narrowed since Phase 0 (`docs/discovery.md` documented 431 visible repos; only 3 are visible now, and `line-tester` isn't one of them). Flagged as a separate finding, not resolved here. |
| `requirements-app-item.json` | **Synthetic**, but the field names/types are real — verified against `project-compass/supabase/migrations/0001_stakeholder_schema.sql`, `0010_client_requests.sql`, `0012_client_request_decisions.sql` directly (`docs/field-mapping.md`). Not a live-fetched row: this platform has no read access to project-compass's separate Supabase project yet. |
| `qa-run.json` | **Synthetic**, matching our own `qa_runs` table (migration 0002) — there is no external QA system to fetch a real payload from (`docs/discovery.md` §0.4: "QA results have nowhere formal today"). This data's real origin will be the minimal QA form, task 4.5. |
