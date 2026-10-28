# Boswell deployment checklist

## Neon database

Project: **boswell-saas** on Neon (`wispy-feather-16066146`). Schema pushed via `npm run db:push`.

Connection string is in your local `.env.local` (not committed). Copy `DATABASE_URL` to Vercel if re-provisioning.

## Sync env to Vercel

Create a different file and credential set for each target. Never copy the production
database or secrets into preview or development:

```bash
./scripts/push-vercel-env.sh production
./scripts/push-vercel-env.sh preview
./scripts/push-vercel-env.sh development
```

Or paste variables manually at [Vercel env settings](https://vercel.com/eddiebms-projects/boswell-saas/settings/environment-variables).

| Variable | Required for live mode |
|----------|----------------------|
| `DATABASE_URL` | Yes (Neon) |
| `AUTH_SECRET` | Yes (`openssl rand -base64 32`) |
| `AUTH_URL` | Yes — your production URL, e.g. `https://boswell-saas.vercel.app` |
| `AUTH_GITHUB_ID` | Yes |
| `AUTH_GITHUB_SECRET` | Yes |
| `WORKER_SECRET` | Yes (random string; unique per environment) |

Optional on Vercel: `OPENROUTER_API_KEY` (enables Pro+ LLM answers in Engineering Brain), `STRIPE_*` (billing).

On the **worker** (required for live audits): `OPENROUTER_API_KEY`, `BOSWELL_ENGINE_GIT_URL`, and the same `AUTH_SECRET` (or `BOSWELL_ENCRYPTION_KEY`) as Vercel — the worker decrypts stored test-account passwords and provider tokens with it.

### Error monitoring (Sentry)

Everything is off until the DSN is set; nothing else is needed to deploy.

1. Create a project at sentry.io with the **Next.js** platform and copy its DSN.
2. **Vercel** (Production, optionally Preview): `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` — the same DSN for both. Redeploy: the browser DSN is built into the bundle.
3. **GitHub Actions secret** `SENTRY_DSN` (same value): reports failed audits, push-guard runs and verification runs from the worker, tagged `component` and `runId`. Worker events use the environment `worker-production`.
4. Optional, for readable browser stack traces — **Vercel**: `SENTRY_AUTH_TOKEN` (Sentry → Settings → Auth Tokens, scope `project:releases`), `SENTRY_ORG`, `SENTRY_PROJECT`. The build then uploads source maps and deletes them from the output, so they're never served to visitors.

What's sent: the error and its stack trace. Request headers, cookies, bodies, query strings, local variables, database queries, user info and repository names are not (`src/lib/monitoring-config.ts`).

**GitHub OAuth app:** add callback  
`https://YOUR_VERCEL_DOMAIN/api/auth/callback/github`

Then run `npm run db:push` locally against the same Neon DB.

## Audit worker (cloud)

Audits run on **GitHub Actions** — not on your laptop or Vercel.

```bash
npm run deploy:worker
```

This sets `DATABASE_URL`, `OPENROUTER_API_KEY`, etc. as GitHub secrets and triggers `.github/workflows/audit-worker.yml` (every 2 minutes).

Optional: Render worker via Blueprint (`render.yaml`) if you prefer a always-on process instead of cron.

## Verify

- Web loads at Vercel URL
- Sign in at `/login` using GitHub OAuth
- `/dashboard/admin` shows env checks green
- Run audit → status moves off `queued` within ~2 min (GitHub Actions worker)
- Team plan: safe-fix PR opens a branch + proposal file (never pushes to main)
- Business plan: executive dashboard unlocked
