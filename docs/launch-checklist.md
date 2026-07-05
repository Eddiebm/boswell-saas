# Soft launch checklist

Use this before sharing Boswell publicly or charging for Pro.

## 1. Production smoke test

```bash
npm run smoke:prod
```

Expect **7/7 checks passed** (6 without `gh` CLI).

Manual checks after signing in:

1. Sync a GitHub repo
2. Run a **quick** audit on a small repo
3. Wait for **completed** (usually 2–10 min)
4. Open report → copy fix prompt
5. Confirm **no** demo banner (unless `BOSWELL_DEMO=1`)

## 2. Failure alerts (ops)

Set on Vercel (and GitHub Actions secrets for worker-side alerts):

| Variable | Example |
|----------|---------|
| `ADMIN_ALERT_EMAIL` | your@email.com |
| `RESEND_API_KEY` | re_... |
| `ALERT_FROM_EMAIL` | Boswell <alerts@yourdomain.com> |

When configured, Boswell emails you when:

- An audit stays **queued > 5 minutes**
- An audit **exceeds max retries**
- An audit **fails** during processing

Check status at `/dashboard/admin` → **Failure alerts** row.

## 3. Marketing audit (screenshot post)

Best repo: **your own public repo** you control (e.g. `Eddiebm/boswell-saas` or `Eddiebm/audiolens-app`).

1. Sign in → **Repositories** → sync
2. Run **standard** audit
3. When complete, capture:
   - Health score (0–1000)
   - Issues found count
   - AI Slop %
   - Release readiness line
   - First 10 lines of fix prompt
4. Post template:

> I ran my repo through Boswell — an AI code auditor that gives you a paste-into-Cursor fix prompt.
>
> Health: **742/1000** · Issues: **12** · AI Slop: **8%**
> Verdict: *Could deploy with fixes*
>
> Try it: https://boswell-saas.vercel.app

## 4. Stripe (before paid launch)

- [ ] `STRIPE_SECRET_KEY` on Vercel
- [ ] `STRIPE_PRICE_PRO` on Vercel
- [ ] `STRIPE_WEBHOOK_SECRET` + webhook endpoint
- [ ] Test upgrade Free → Pro with a real card
- [ ] Confirm plan updates in `/dashboard/billing`

## 5. Go / no-go

| Gate | Required for beta | Required for paid ads |
|------|-------------------|------------------------|
| Smoke test passes | Yes | Yes |
| One real completed audit | Yes | Yes |
| Failure alerts configured | Recommended | Yes |
| Stripe live | No | Yes |
| Support channel (email/Discord) | Recommended | Yes |
