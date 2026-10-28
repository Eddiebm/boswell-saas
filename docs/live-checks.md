# Live checks

Set the app's deployed URL on **Ship Ready → Live site**. Every full audit
then checks the running app as well as the code. All of it is read-only:
GET requests and page loads, never a form submission or anything that
changes data (enforced by `src/lib/checks/security-invariants.test.ts`).

## What runs

| Check | Rule ids | How |
|---|---|---|
| HTTPS and redirect from http:// | `web.no-https` | GET `/` and `http://host/` |
| Security headers actually served | `web.live-headers` | response headers on `/` |
| Files that must never be public | `secrets.exposed-file`, `web.exposed-file` | `/.env`, `/.env.local`, `/.env.production`, `/.git/HEAD`, `/.git/config`, `/.DS_Store` — each with a content check, so sites that answer every path with their homepage aren't flagged |
| Keys in the JavaScript every visitor downloads | `secrets.live-bundle` | same-origin scripts on `/`, scanned with the same patterns as the code scan |
| Downloadable source maps | `web.live-source-maps` | `sourceMappingURL` of those scripts |
| API routes that answer without a login | `authz.public-data` | GET every static API route found in the code (Next.js `route.ts` / `pages/api`), skipping ones public by design (auth, webhooks, health…); only field names are kept, never response bodies |
| Admin routes a normal user can open | `authz.admin-reachable` | when live verification is set up, admin routes that refuse strangers are retried as test account B |
| Pages load in a real browser | `ops.page-broken`, `ops.console-errors`, `web.mobile-overflow`, `ops.slow-page` | Chromium loads up to 8 pages at desktop and phone sizes; signed in as account B when available |

Static authorization checks run on every audit and push-guard run, with or
without a live URL: request bodies written straight to the database
(`authz.mass-assignment`) and admin routes with no role or secret check
(`authz.admin-unguarded`).

## Safety

- The URL, and every redirect hop, must resolve to a public address (no
  localhost, private ranges or cloud metadata).
- Response bodies are capped at 5 MB and inspected in memory.
- Chromium starts with an empty environment (none of the worker's secrets),
  requests to private addresses are aborted, and a test-account cookie is
  scoped to the app's own domain so third-party scripts never get it.

## Requirements

- Workers install Chromium (`npx playwright-core install --with-deps chromium`
  in the GitHub Actions worker and `Dockerfile.worker`). Without a browser the
  smoke test reports "couldn't run" and Ship Ready asks the user to confirm.
- Migration: `repositories.live_url`.
