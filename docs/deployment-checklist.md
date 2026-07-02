# Boswell deployment checklist

## Neon database

Project: **boswell-saas** on Neon (`wispy-feather-16066146`). Schema pushed via `npm run db:push`.

Connection string is in your local `.env.local` (not committed). Copy `DATABASE_URL` to Vercel if re-provisioning.

## Sync env to Vercel

After filling `.env.local`:

```bash
./scripts/push-vercel-env.sh
```

Or paste variables manually at [Vercel env settings](https://vercel.com/eddiebms-projects/boswell-saas/settings/environment-variables).

| Variable | Required for live mode |
|----------|----------------------|
| `DATABASE_URL` | Yes (Neon) |
| `AUTH_SECRET` | Yes (`openssl rand -base64 32`) |
| `AUTH_URL` | Yes — your production URL, e.g. `https://boswell-saas.vercel.app` |
| `AUTH_GITHUB_ID` | Yes |
| `AUTH_GITHUB_SECRET` | Yes |
| `WORKER_SECRET` | Yes (random string) |

Optional on Vercel: `OPENROUTER_API_KEY` (enables Pro+ LLM answers in Engineering Brain), `STRIPE_*` (billing).

On the **worker** (required for live audits): `OPENROUTER_API_KEY`, `BOSWELL_ENGINE_GIT_URL`.

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
- Sign in at `/login` → **Continue as owner** (or GitHub OAuth when configured)
- `/dashboard/admin` shows env checks green
- Run audit → status moves off `queued` within ~2 min (GitHub Actions worker)
- Team plan: safe-fix PR opens a branch + proposal file (never pushes to main)
- Business plan: executive dashboard unlocked
