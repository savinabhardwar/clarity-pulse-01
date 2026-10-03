# Frontend on Cloudflare Workers

The React/TanStack frontend and its thin Python API proxy deploy together as
one Worker with static assets. The Python API stays on its separate host.
This pipeline deploys no Python jobs, databases, or automation Workers.

## Branches and destinations

- `main`: GitHub environment `production`, existing production frontend Worker.
- `staging`: GitHub environment `staging`, separate Worker ending in `-staging`.
- Pull requests and other branches cannot deploy. Manual runs select `main` or
  `staging`; the branch determines the environment.

In each repository configure these **GitHub environment** settings, using the
existing Cloudflare account and existing production Worker name:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Account-scoped Workers deployment token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | That Cloudflare account ID |
| Variable | `CLOUDFLARE_FRONTEND_WORKER_NAME` | Exact Worker name for this environment |
| Variable | `FRONTEND_BACKEND_URL` | HTTPS Python API service origin |
| Optional secret | `BACKEND_PROTECTION_BYPASS` | Vercel automation bypass for a protected API |

Restrict environment `production` to `main`, and `staging` to `staging`.
Production must use its production API. Staging must use the dedicated staging
API recorded in `service.json`. A staging Worker name must end in `-staging`;
production names cannot. Names are required, avoiding Nitro's inferred default
silently creating a different Worker. For an existing Worker with custom-domain routes, record those routes in the
canonical Wrangler config before enabling this workflow. The current template
uses the Worker deployment target without adding custom routes.

## Files and build

- `wrangler.json`: canonical bundle/assets/runtime configuration.
- `service.json`: application backend binding name and staging API origin.
- `prepare.py`: branch/destination validation and generated deploy config.
- `.github/workflows/deploy-frontend-cloudflare.yml`: required GitHub entrypoint.

CI installs locked frontend dependencies, checks types/lint and deployment
boundaries, builds with `NITRO_PRESET=cloudflare-module`, then prepares the
explicit `.output/server/wrangler.production.json` or `wrangler.staging.json`.
Wrangler deploys that config with its server bundle and static assets. Generated
files stay ignored. Backend URLs are runtime Worker vars, not browser credentials.
The optional bypass secret is forwarded only by the frontend server adapter;
Supabase/Jira credentials remain in Python. Preserve any existing bypass secret
when deploying a protected environment; empty GitHub secrets are not uploaded.

Run boundary checks locally:

```sh
python -m pip install 'PyYAML>=6,<7'
python -m unittest discover -s deployment/frontend/cloudflare -p 'test_*.py' -v
```

Configure credentials/settings before pushing changes that should deploy.
No remote deployment or Git push is performed by creating these files. If
Cloudflare Workers Builds already deploys this Worker from Git, choose one CI
owner to avoid duplicate deployments: this GitHub workflow or Workers Builds.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
[Wrangler Action](https://github.com/cloudflare/wrangler-action).
