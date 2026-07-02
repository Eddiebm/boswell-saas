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

## Render (audit worker)

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `github.com/Eddiebm/boswell-saas`
3. Set env vars on the worker service:
   - `DATABASE_URL`
   - `OPENROUTER_API_KEY`
   - `WORKER_SECRET` (same as Vercel)

Worker runs `npm run worker` (polls audit queue, needs git + python3 on Render).

## Verify

- Web loads at Vercel URL
- Sign in with GitHub works
- `/dashboard/admin` shows env checks green
- Run audit → status moves off `queued` within ~1 min (worker running)
- Team plan: safe-fix PR opens a branch + proposal file (never pushes to main)
- Business plan: executive dashboard unlocked
