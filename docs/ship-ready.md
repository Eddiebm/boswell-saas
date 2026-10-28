# Ship Ready

One verdict per app: **Ship Ready**, **No blockers — confirm the rest**, or
**Not ready to ship: N blockers**. It's built from the latest audit's
findings, what Boswell's checks could actually see, and the latest live
verification run. Page: `/dashboard/ship-ready` (or `?audit=<id>`).

## The checklist

| Item | Decided by | Blocks at |
|---|---|---|
| Users can't see each other's data | Live verification (two-account test); routes returning secret columns | proven leak |
| The database rejects strangers | Supabase migrations without RLS, Firebase rules in test mode / `if true`, service-role key in client code | HIGH |
| No secret keys in code or the browser | Live keys and service-role JWTs in code **or in the last 50 commits' history**, committed `.env` files, secrets in `NEXT_PUBLIC_` vars, engine secret findings | HIGH |
| Payments can't be faked | Unverified Stripe webhooks, prices taken from the request | HIGH |
| Nobody can run up your AI bill | Paid AI routes with no login check or no rate limit | MEDIUM (pattern → review) |
| No known-vulnerable packages, clean installs work | npm audit triage for package-lock.json; npm's advisory database for pnpm, yarn and bun lockfiles; OSV for requirements.txt, poetry.lock, Pipfile.lock and Gemfile.lock; lockfile drift / invalid lockfile (always block) | HIGH |
| No critical issues in the code review | The engine's own findings | CRITICAL (HIGH → review) |
| Server code can't be turned against you | SSRF, data-wiping refreshes, missing timeouts | MEDIUM (pattern → review) |
| Every setting the app needs is documented | Undocumented env vars | review only |
| You'll know when something breaks | No error monitoring, or Sentry not wired up | MEDIUM |
| The site is hardened | Public source maps, missing security headers | MEDIUM |
| The legal basics are in place | Privacy policy when collecting personal data; terms and refund policy when taking payments; cookie consent when loading tracking scripts | LOW |
| Health data is handled lawfully | Shown only when the schema stores health records (patients, prescriptions, diagnoses…): HIPAA/BAA steps | review |
| Database backups are on | Can't be seen from code — provider-specific steps | confirm |
| Something tells you when the site goes down | Can't be seen from code — steps (including Supabase's free-tier pausing) | confirm |
| Your emails won't land in spam | Can't be seen from code (when the app sends email) — steps | confirm |

## Rules that keep the verdict honest

- **Proof vs. pattern.** A finding at confidence ≥ 0.8 can block. Pattern
  matches below that put the item in "Check before launch" instead.
- **Nothing passes unless it was checked.** Each audit stores what its
  checks could see (`audit_runs.checks_json`). If the dependency audit
  couldn't run, or there are no Supabase migrations to read, the item is
  "Confirm yourself", never "Pass". Audits from before Ship Ready ask for
  a re-run.
- **Items that don't apply are marked "Not needed"** (no payments, no email,
  no browser-side database).
- **A clean repo is never fully "Ship Ready" on its own**: backups and uptime
  can't be seen from code, so they always need confirming.

## Fixes

Every blocker and review item comes with a copy-paste prompt for the user's
AI coding tool, and the banner has one prompt covering all of them.
Vulnerable dependencies link to Boswell's dependency fix PR when one is
ready. Manual items list the exact steps for the detected stack (Supabase,
Neon, Firebase, Resend, …).

Findings from Boswell's own checks carry a `rule_id` (stored on
`findings.rule_id`), which is how they map to checklist items.

## What leaves the worker

Dependency lookups send only package names and versions: to the npm registry
(for every JavaScript lockfile) and to osv.dev (Python and Ruby). No package
manager runs for pnpm, yarn, bun, Python or Ruby projects — their lockfiles
are parsed as text. The git-history scan runs `git log` with external diff
drivers and textconv disabled and none of the worker's environment.
