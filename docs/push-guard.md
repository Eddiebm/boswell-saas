# Push guard

Turn it on from **Ship Ready → Push guard** (Pro). Boswell creates a webhook
on the repository for `push` and `pull_request` events, with its own signing
secret (stored encrypted).

On every push to the default branch, and every pull request opened or
updated:

1. GitHub calls `POST /api/github/webhook`. The signature is checked against
   that repository's secret and the payload's repository id must match.
2. The commit gets a **pending** status (`Boswell / Ship Ready`) and a
   checks-only run is queued. Runs still waiting for the same branch or PR
   are pointed at the newest commit rather than piling up.
3. The worker clones, checks out that exact commit (fork PRs via
   `refs/pull/N/head`), and runs Boswell's own checks — no AI engine, no
   cost, nothing from the repository executed.
4. The result is compared with the default branch's latest known state
   (the last guard run on it, or the last full audit with checks).
   - **failure** only when the change adds a launch blocker,
   - **success** otherwise; existing blockers are mentioned, not counted
     against the change, and fixes are credited.
5. Pull requests get one Boswell comment, edited in place on each push.

Pushes to the default branch keep Ship Ready current: after a fix is merged,
the checklist reflects it without a new full audit. Engine (AI) findings
still come from the latest full audit.

Guard runs never touch scores, reports, the fix queue or the findings list —
their results live on the run (`audit_runs.guard_json`).

## Requirements

- `AUTH_URL` must be the public URL of the app (GitHub delivers webhooks there).
- The user needs admin access to the repository to create webhooks.
- Migration: `repositories.guard_webhook_id`, `guard_secret`,
  `guard_enabled_at`; `audit_runs.trigger`, `target_sha`, `pr_number`,
  `guard_json` (applied by the db-migrate workflow on merge).
