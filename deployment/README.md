# Deployment configuration

| Service | Environment | Canonical configuration |
| --- | --- | --- |
| Frontend Worker | Production and staging | [frontend/cloudflare](frontend/cloudflare/README.md) |
| Python API | Staging | [backend/staging](backend/staging/README.md) |
| Python API | Production | No production Vercel workflow configured here |

GitHub discovers workflows only in `.github/workflows/`. Staging templates are
materialized only by guarded CI and are ignored by Git. They never override
`main` automatically. Environment values remain in hosting/GitHub environment
secrets, not in these files.

Existing frontend and automation platform entrypoints remain where their build
tools require them. They are independent of the backend staging deployment.
