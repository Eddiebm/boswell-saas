# Boswell — AI Engineering CTO

Boswell watches your repositories, understands what changed, remembers engineering decisions, scores code health, and tells you exactly what to fix next.

## What works today

| Feature | Status |
|---------|--------|
| Repo audit + fix prompt | **Live** |
| OWASP Top 10:2021 mapping | **Heuristic** (per-finding, on reports) |
| Health score 0–1000 (9 dimensions) | **Deterministic engine** |
| AI Slop Score | **Deterministic scanner** |
| Audit modes (quick / standard / deep) | **Live** |
| Fix Queue prioritization | **Implemented** |
| Good / bad / dangerous / evil classification | **Implemented** |
| Engineering Memory | **DB-backed** (after audit) |
| Engineering Brain Q&A | **Templates on Free, LLM on Pro** |
| Safe-fix PR creation | **Live on Pro** (GitHub branch PR) |
| GitHub OAuth + audits | **Live** (requires env) |
| Stripe billing | **Free + Pro** (requires env) |
| Demo mode | **Explicit only** (`BOSWELL_DEMO=1`) |

## Deployed

| Service | URL |
|---------|-----|
| **Web (Vercel)** | https://boswell-saas.vercel.app |
| **Worker (Render)** | Deploy via [Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint) → connect this repo |

See **[docs/deployment-checklist.md](docs/deployment-checklist.md)** for required environment variables.

## Quick start (no credentials)

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Open demo dashboard**

Demo mode activates when `BOSWELL_DEMO=1`. Without `DATABASE_URL`, live mode will error — it does not silently fall back to demo.

## Full local setup (live audits)

See **[docs/live-audit-setup.md](docs/live-audit-setup.md)** for the complete guide.

```bash
cp .env.example .env.local
# Fill DATABASE_URL, AUTH_*, OPENROUTER_API_KEY, WORKER_SECRET
npm run db:push
npm run dev:live    # NOT npm run dev (that enables demo mode)
```

Sign in → Sync repos → Run audit. **Production audits run on GitHub Actions** (every 2 minutes). For local worker dev only: `BOSWELL_ALLOW_LOCAL_WORKER=1 npm run worker`.

## Tests

```bash
npm test
```

Covers: scoring, audit parser, fix-queue, AI slop, classification, safe-fix policy, report generation, memory queries.

## Documentation

See `docs/` for architecture, deployment, scoring methodology, and safety policy.

- **Web:** Next.js 16 App Router on Vercel
- **DB:** Neon Postgres + Drizzle ORM
- **Auth:** NextAuth (GitHub)
- **Audits:** Boswell Python engine via GitHub Actions worker (`.github/workflows/audit-worker.yml`)
- **Scoring:** TypeScript deterministic weights (LLM explains, does not invent scores)

## Pages

- `/` — Landing
- `/dashboard` — Daily CTO Briefing
- `/dashboard/executive` — Founder summary
- `/dashboard/repos` — Repository list + scores
- `/dashboard/repos/[id]` — Detail, slop, timeline
- `/dashboard/audits/[id]` — Report + coaching
- `/dashboard/fix-queue` — Prioritized work
- `/dashboard/memory` — Engineering memory
- `/dashboard/brain` — Q&A
- `/dashboard/settings` — Config
- `/dashboard/billing` — Plans
- `/dashboard/admin` — System health

## Repos

- Engine: https://github.com/Eddiebm/boswell
- SaaS: https://github.com/Eddiebm/boswell-saas

## Honest limitations

- Engineering Brain uses grounded templates in demo; production LLM Q&A needs `OPENROUTER_API_KEY` wiring.
- Safe-fix PR creation is simulated in demo; live PRs need GitHub token + implementation in `/api/pr/create`.
- Vercel cannot run long Python audits — use Render worker (`render.yaml`).
