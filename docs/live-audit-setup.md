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

## 4. Start services

**Terminal 1 — web (live mode):**

```bash
npm run dev:live
```

**Terminal 2 — worker:**

```bash
npm run worker
```

The worker needs `git`, `python3`, and `pip` on PATH.

## 5. Run an audit

1. Sign in with GitHub at http://localhost:3000
2. **Repositories** → **Sync GitHub repos**
3. Click **Run audit** on a repo
4. Watch status at `/dashboard/audits/[id]` (polls every 5s while queued/running)
5. Check **System health** at `/dashboard/admin` if stuck

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Stuck on `queued` | Worker not running — start `npm run worker` |
| `OPENROUTER_API_KEY is not configured` | Add key to `.env.local`, restart worker |
| `Missing GitHub token` | Sign out and sign in again |
| Audit `failed` immediately on Vercel | Audits must run on worker host, not Vercel |

## Production

- **Vercel:** Next.js app only
- **Render:** Deploy worker from `render.yaml` with same env vars
