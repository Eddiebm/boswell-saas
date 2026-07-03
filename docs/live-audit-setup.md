# Live audit setup

## 1. Environment

Copy `.env.example` to `.env.local` and fill:

```bash
DATABASE_URL=postgresql://...
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=http://localhost:3000
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...
OPENROUTER_API_KEY=sk-or-...
WORKER_SECRET=some-random-string
```

Do **not** set `BOSWELL_DEMO=1`.

## 2. Database

```bash
npm run db:push
```

## 3. GitHub OAuth app

- Callback URL: `http://localhost:3000/api/auth/callback/github`
- Scopes: `read:user`, `user:email`, `repo` (configured in auth)

## 4. Start web (live mode)

```bash
npm run dev:live
```

## 5. Audit worker

**Production:** GitHub Actions runs `.github/workflows/audit-worker.yml` every 2 minutes. Deploy secrets with:

```bash
npm run deploy:worker
```

**Local dev only** (optional):

```bash
BOSWELL_ALLOW_LOCAL_WORKER=1 npm run worker
```

Requires `git`, `python3`, and `pip` on PATH. Do not run a local worker against production unless you know what you're doing — it can steal queued audits.

## 6. Run an audit

1. Sign in with GitHub at http://localhost:3000
2. **Repositories** → **Sync GitHub repos**
3. Click **Run audit** on a repo
4. Watch status at `/dashboard/audits/[id]` (polls every 5s while queued/running)
5. Check **System health** at `/dashboard/admin` if stuck

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Stuck on `queued` | Check [GitHub Actions worker](https://github.com/Eddiebm/boswell-saas/actions/workflows/audit-worker.yml) or run workflow manually |
| `OPENROUTER_API_KEY is not configured` | Add key to GitHub Actions secrets (`npm run deploy:worker`) |
| `Missing GitHub token` | Sign out and sign in again |
| Audit `failed` with `/opt/homebrew/bin/boswell` | Stop local `npm run worker` — use cloud worker only |
| Audit `failed` immediately on Vercel | Audits must run on worker host, not Vercel |

## Production

- **Vercel:** Next.js app only
- **GitHub Actions:** Audit worker (recommended)
- **Render:** Optional always-on worker via `render.yaml`
