# Boswell — AI Engineering CTO

Boswell watches your repositories, understands what changed, remembers engineering decisions, scores code health, and tells you exactly what to fix next.

## What works today

| Feature | Status |
|---------|--------|
| Daily CTO Briefing | **Demo + live** (after audit) |
| Health score 0–1000 (9 dimensions) | **Deterministic engine** |
| AI Slop Score | **Deterministic scanner** |
| Engineering Memory | **Demo + DB-backed events** |
| Fix Queue prioritization | **Implemented** |
| Good / bad / dangerous / evil classification | **Implemented** |
| Safe automation (green/yellow/red) | **Implemented** |
| Structured audit reports (JSON + markdown) | **Implemented** |
| Evidence-backed Brain Q&A | **Demo + API** |
| Business billing tier | **Placeholder** |
| Coaching sections per finding | **Implemented** |
| PR mode (no push to main) | **API stub + policy** |
| GitHub OAuth + audits | **Requires env** |
| Stripe billing | **Requires env** |

## Quick start (no credentials)

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Open demo dashboard**

Demo mode activates when `BOSWELL_DEMO=1` or `DATABASE_URL` is unset.

## Full local setup

```bash
cp .env.example .env.local
# Fill DATABASE_URL, AUTH_GITHUB_*, OPENROUTER_API_KEY
npm run db:push
npm run dev:live
npm run worker   # separate terminal — processes audit jobs
```

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
- **Audits:** Boswell Python engine via background worker (`npm run worker`)
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
