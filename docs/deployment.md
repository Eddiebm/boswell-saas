# Deployment guide

## Web (Vercel)

1. Connect `github.com/Eddiebm/boswell-saas`
2. Set environment variables from `.env.example`
3. Deploy — **do not** run audits on Vercel serverless

## Worker (Render / Railway / VPS)

```bash
npm install
npm run worker
```

Use `render.yaml` for Render background worker. Worker needs:

- `DATABASE_URL`
- `WORKER_SECRET`
- `OPENROUTER_API_KEY` (for engine LLM audits)
- `BOSWELL_ENGINE_GIT_URL` (default: Boswell GitHub repo)

## Database (Neon)

```bash
npm run db:push
npm run db:seed   # optional seed data
```

## Health check

- Web: `GET /dashboard/admin`
- Worker: logs `Boswell worker started`, processes queued audits
