# Boswell Cloud

Hosted SaaS for the [Boswell](https://github.com/Eddiebm/boswell) repo auditor.

## Stack

- Next.js 16 (App Router)
- NextAuth (GitHub OAuth)
- Neon Postgres + Drizzle ORM
- Stripe subscriptions
- Boswell Python engine (installed at worker runtime)
- Render worker for long-running audits

## Features

- GitHub sign-in and repo sync
- Queue cloud audits per repository
- View findings, audit reports, and handoff docs
- Free / Pro / Team plans with usage limits
- Stripe billing for paid tiers

## Local development

```bash
cp .env.example .env.local
npm install
npm run db:push
npm run dev
```

In another terminal, run the audit worker:

```bash
npm run worker
```

## Environment variables

See `.env.example`.

## Deployment

1. Deploy web app to **Vercel**
2. Deploy worker to **Render** using `render.yaml`
3. Create a GitHub OAuth app with callback:
   `https://your-domain/api/auth/callback/github`
4. Create Stripe products/prices and set webhook to:
   `https://your-domain/api/stripe/webhook`
5. Set `WORKER_SECRET` on Vercel and pass it as `x-worker-secret` header from Render cron (optional fallback)

## Repos

- Engine: https://github.com/Eddiebm/boswell
- SaaS: https://github.com/Eddiebm/boswell-saas
