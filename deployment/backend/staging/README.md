# ClarityPulse: Vercel backend staging

## Deployment on 2026-10-02

The API is deployed at https://clarity-pulse-backend-staging.vercel.app in the
`lurchyys-projects` Hobby account, with Python 3.12 and `backend` as Root
Directory. Vercel Authentication protects the staging domain. Health and
database-backed project reads were checked using authenticated `vercel curl`.

This deployment uses the current local Python implementation. The remote
staging branch still has the older layout; publishing the current code and
workflow to staging and setting the GitHub deployment secrets remain required
to enable automatic deployments.
The staging API now uses the isolated `ai-pm-staging` Supabase project
(`qqrwaredergqifiwsrtv`) in the user's personal organization, hosted in Mumbai
on the Free plan. The source database was accessed read-only; main/local
database settings were not changed. This is a one-time copy, without ongoing
replication. Application permissions were matched with explicit user approval.
Verified all 42 application tables (12,949 rows) by count and checksum, and
all three attachments by SHA-256. Live health, project reads, people RPC and
organization metrics checks passed.

The staging-only `repository.vercelignore` template excludes environment files, frontend code, local Python
tools, npm caches and automation resources. The workflow pins the tested
Vercel CLI 62.2.0, parses its JSON deployment output, and uses authenticated
`vercel curl` for protected health checks.

The workflow in `.github/workflows/deploy-backend-staging.yml` tests the
FastAPI API, builds it on Vercel, deploys it, and checks `/api/health` on
pushes to `staging` that change the API, its tests, or deployment configuration.
Manual runs are supported; select the staging branch. Other branches cannot deploy.

## One-time setup

1. Create a **dedicated backend staging project** in Vercel using this repository.
   Do not reuse a production API or frontend project.
2. Set **Root Directory** to `backend`, framework to **FastAPI**, and Python
   to **3.12**. Keep the framework's default install/build commands and output
   directory; remove any inherited frontend command or output override.
   Set the Git production branch to `staging`.
3. Disable Vercel automatic Git deployments in the dashboard before the initial
   import if available. Disable Git integration on the dedicated staging project in Vercel Settings.
   The staging config is generated only during CI; it is not an auto-discovered
   configuration for `main`. GitHub Actions owns staging deployments. An initial
   import deployment may still run.
4. Configure runtime environment variables on this project's **Production**
   environment from `backend/.env.example`. Use staging Supabase resources.
   Never copy a local environment file into Git. The API needs Supabase URL
   and anon key; Compass also needs Jira credentials and a webhook secret
   for those integrations. ClarityPulse's scheduled-job credentials are
   not required by its dashboard API.
5. In GitHub, create an environment named `staging`, restricted to that branch,
   with these secrets:
   - `VERCEL_TOKEN`: a Vercel access token.
   - `VERCEL_ORG_ID`: the Vercel account/team ID.
   - `VERCEL_BACKEND_PROJECT_ID`: this dedicated backend staging project's ID.
   - `VERCEL_PROTECTION_BYPASS`: optional automation bypass secret when
     Deployment Protection protects the health-check URL.
   IDs can be obtained from project settings or `.vercel/project.json` after
   linking the repository root with `vercel link` to the pinned staging project. That generated directory
   is ignored by Git.
6. Push the configuration to `staging`, or run the workflow manually on that
   branch. A successful run records the deployment URL in its GitHub summary.
7. Configure the frontend server's `CLARITY_BACKEND_URL` with the staging
   project's stable production-domain URL, rather than an individual deployment
   URL. Confirm that the frontend server can reach it. If Deployment Protection
   protects that domain, configure `BACKEND_PROTECTION_BYPASS` in the frontend GitHub environment
   so its Worker can send the server-only bypass header. The workflow's optional bypass
   secret only authenticates its health check. Without it, authenticated
   `vercel curl` can generate a bypass for the workflow's token; keep the
   project's Deployment Protection enabled.

## Why the workflow uses --prod

The Vercel project itself is staging-only. Its Production environment gives
staging a stable domain and works without a paid custom environment.
The workflow uses `vercel pull --environment=production` and
`vercel deploy --prod` **only for that staging project**. Vercel builds the
filtered source remotely so ignored files cannot become dangling prebuilt links.
Commands run at the repository root; the project's Root Directory selects
`backend`. Do not also change the workflow working directory to backend.

Deploy jobs queue instead of interrupting a deployment in progress. Tests must
pass before deployment. A failed health check reports a failed workflow but
does not automatically roll back the deployment. The health endpoint checks
process liveness; it does not verify Supabase or Jira availability.

## Scope and hosting limits

This deploys the Python API only. Frontend deployments and database migrations
are separate. ClarityPulse's automation Workers and scheduled Jira/release
jobs keep their existing deployment or scheduling mechanism.

Vercel Hobby is free subject to its quotas and personal, non-commercial usage
rules; this configuration does not remove those restrictions.

Vercel Functions cap request and response bodies at 4.5 MB. Compass currently
accepts attachments up to 20 MB through its API, so uploads approaching or
exceeding the platform limit fail before the API can process them. Preserving
20 MB uploads requires a separate direct-to-storage upload design. Runtime
limits also apply to long API operations; a successful health check alone
does not establish that every feature fits the free tier.

References:
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [GitHub Actions deployment](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)
- [Function limits](https://vercel.com/docs/functions/limitations)
- [Hobby usage rules](https://vercel.com/docs/plans/hobby)

## Configuration ownership and branch isolation

Canonical staging files live in `deployment/backend/staging/`. GitHub requires
its workflow entrypoint to remain in `.github/workflows/`. Both test and deploy
jobs are gated to `refs/heads/staging`, including manual runs. `main` never
runs these jobs. GitHub environment `staging` should also allow only that branch.

Before any Vercel command, `prepare.py` validates the branch, event, the project
ID pinned in `project.json`, and any existing local Vercel link. It refuses a
production project ID or an overwrite. It then generates ignored
`backend/vercel.json` and both `.vercelignore` files for that CI checkout.
Cleanup removes only files still matching their staging templates.
The checked-in backend package entrypoint is environment-neutral Python API
metadata; it contains no staging database or project destination.

A merge into `main` carries the templates as inert source files. It does not
activate them or change production secrets. Existing Netlify frontend config
and Cloudflare automation configs stay at the locations required by their tools.

**Existing Vercel dashboard settings are separate from repository files.**
Disable Git integration on the dedicated staging Vercel project (or configure
it to skip every Git build) so its automatic deployments cannot bypass these CI
guards. Keep its Root Directory `backend`, and keep production/frontend projects
separate. Read-only Vercel API inspection on 2026-10-03 confirmed both dedicated staging
projects have no Git integration connected and Root Directory `backend`. This
cleanup does not edit remote settings, deploy, or push branches.

Validate the guards offline from the repository root:

```sh
python -m unittest discover -s deployment/backend/staging -p 'test_*.py' -v
```
