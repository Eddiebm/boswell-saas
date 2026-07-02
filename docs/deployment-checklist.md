# Boswell deployment checklist

## Vercel (web app)

After `vercel --prod`, set these in **Project → Settings → Environment Variables**:

| Variable | Required for live mode |
|----------|----------------------|
| `DATABASE_URL` | Yes (Neon) |
| `AUTH_SECRET` | Yes (`openssl rand -base64 32`) |
| `AUTH_URL` | Yes — your production URL, e.g. `https://boswell-saas.vercel.app` |
| `AUTH_GITHUB_ID` | Yes |
| `AUTH_GITHUB_SECRET` | Yes |
| `WORKER_SECRET` | Yes (random string) |

Optional: `STRIPE_*`, `OPENROUTER_API_KEY` (not needed on Vercel — worker only).

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
