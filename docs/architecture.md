# Architecture

## Overview

Boswell SaaS is a Next.js 16 application with a background worker for audits.

```
Browser → Next.js (Vercel) → Neon Postgres
                ↓
         Worker process → clone repo → Boswell Python engine
```

## Core modules

| Module | Path | Role |
|--------|------|------|
| Scoring | `src/lib/scoring/` | Deterministic 0–1000 health score |
| AI Slop | `src/lib/slop/` | Pattern-based slop detection |
| Classification | `src/lib/classification/` | Good / bad / dangerous / evil |
| Safe automation | `src/lib/automation/` | Green / yellow / red fix policy |
| Coaching | `src/lib/coaching/` | Plain-English finding explanations |
| Briefing | `src/lib/briefing/` | Daily CTO briefing builder |
| Memory | `src/lib/memory/` | Evidence-based memory queries |
| Brain | `src/lib/brain/` | Repo Q&A with citations |
| Reports | `src/lib/reports/` | Structured JSON + markdown |
| Worker | `src/lib/worker/` | Audit job processing + job queue |

## Audit flow

1. User queues audit via API
2. Worker claims job (never in serverless request)
3. Repo cloned with GitHub token
4. Boswell engine runs (`pip install` from GitHub)
5. Findings parsed, enriched, scored
6. Memory events + fix queue + report saved
7. Dashboard updates from DB

## Demo mode

When `BOSWELL_DEMO=1` or `DATABASE_URL` is unset, all data comes from `src/lib/demo/data.ts`.

## Security

- No push to main
- Tokens encrypted at rest (Neon)
- Worker endpoint protected by `WORKER_SECRET`
- Auth via NextAuth GitHub OAuth
