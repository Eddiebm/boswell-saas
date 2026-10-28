# Moving from the OAuth `repo` scope to a GitHub App

Status: plan, not started.

## Why

Today Boswell signs users in with an OAuth App and asks for
`read:user user:email repo` (`src/lib/auth.ts`). The `repo` scope is
read **and write** access to every repository the user can reach, private
ones and every organization's included. The token:

- is stored as-is in `accounts.access_token` by the Auth.js adapter,
- never expires (OAuth App tokens don't),
- is read by the worker on GitHub Actions for every job.

So one leaked database row means write access to all of a customer's code,
and a database dump means the same for every customer. It's also the first
thing a customer's security reviewer will flag, and organizations that
restrict OAuth Apps block Boswell outright.

A GitHub App fixes this:

| | OAuth `repo` today | GitHub App |
|---|---|---|
| Which repos | everything the user can see | only the repos the user picks at install |
| What access | full read/write, settings included | the permissions listed below, nothing else |
| Token lifetime | forever | 1 hour, minted per job, never stored |
| Narrowed per job | no | yes: one repo, only the permissions that job needs |
| Push guard webhooks | one per repo, needs repo **admin** | one app-wide webhook, no admin needed |
| Org policy | blocked where OAuth Apps are restricted | org owner approves the install once |

## What Boswell does with GitHub

Every call site, so nothing is missed:

| Feature | Code | GitHub access |
|---|---|---|
| Sign in | `src/lib/auth.ts` | identity, email |
| Repo picker | `src/lib/github.ts` `listGithubRepos` (`repos.listForAuthenticatedUser`) | list repos |
| Audit / guard clone | `src/lib/worker/process-audit.ts` `authedCloneUrl` | contents: read |
| Audit runner | `src/lib/audits.ts` → `getGithubToken(run.userId)` | passes the token on |
| Push guard on/off | `src/lib/guard/service.ts` (`createWebhook`, `deleteWebhook`) | repo hooks (admin) |
| Push guard events | `src/app/api/github/webhook/route.ts`, per-repo secret | — |
| Push guard result | `src/lib/guard/run.ts` (`createCommitStatus`, PR comments) | commit statuses: write, pull requests: write |
| Safe-fix PR | `src/lib/github/pr.ts` (`getContent`, `createOrUpdateFileContents`, `createRef`, `pulls.create`) | contents: write, pull requests: write |
| Dependency-fix PR | `src/lib/github/dependency-pr.ts` (blobs, trees, commits, refs, `pulls.create`) | contents: write, pull requests: write |

## The app

**Boswell** (the one everyone installs):

- Repository permissions:
  - Metadata: read (required).
  - Contents: **read**.
  - Commit statuses: read & write (the push guard's pending/pass/fail).
  - Pull requests: read & write (the push guard's comment). This permission
    can't push code.
- Account permissions: Email addresses: read.
- Events: `installation`, `installation_repositories`, `push`, `pull_request`.
- Setup and callback URLs on the app; tick *Request user authorization
  (OAuth) during installation* and *Expire user authorization tokens*.

Fix PRs are the only feature that writes code, so they shouldn't force
write access on everyone. **Recommendation:** a second, optional app,
**Boswell Fix**, with Contents: read & write and Pull requests: read & write.
Users install it from the fix-PR button only when they want PRs, on the
repos they choose. Until it's installed, the button offers the patch to
copy instead. (The simpler alternative is to give the main app Contents:
write. That's still far narrower than `repo`, but every customer then grants
write access to use a read-only audit.)

## How tokens work after the move

1. **Sign in** uses the Boswell app's client id/secret with the same Auth.js
   GitHub provider. GitHub Apps ignore scopes: the user token can only see
   what the user has installed the app on. Boswell stops reading it for
   repository work.
2. **Connect repositories** sends the user to
   `https://github.com/apps/<slug>/installations/new`. GitHub returns to the
   setup URL with `installation_id`.
3. **Check ownership before linking.** An `installation_id` in a URL proves
   nothing: anyone could paste someone else's. Call `GET /user/installations`
   with the signed-in user's token and link only an id that appears there.
   Carry a `state` value through the round trip as well.
4. **Per job**, mint an installation token with the app's private key (a JWT
   that lasts 10 minutes, then `POST /app/installations/{id}/access_tokens`).
   Narrow it to `repository_ids: [repo.githubId]` and the permissions the job
   needs: `{ contents: "read" }` for an audit, plus `statuses` and
   `pull_requests` for a guard run. It lasts an hour and is never written to
   the database. `@octokit/auth-app` handles the JWT and caching.
5. **Clone** stays the same: `https://x-access-token:<token>@github.com/...`
   works with installation tokens, and `redactSecrets` already catches
   `ghs_` tokens in error text.

## Data changes (additive first)

- New table `github_installations`:
  - `id` (GitHub installation id, bigint primary key),
  - `user_id`,
  - `app` (`main` | `fix`),
  - `account_login`, `account_type`,
  - `repository_selection`,
  - `suspended_at`, `created_at`.
- `repositories.installation_id` (nullable; null means the repo still uses
  the legacy OAuth token).
- Later, and destructive, so applied by hand rather than by the db-migrate
  workflow:
  - drop `repositories.guard_webhook_id` and `guard_secret`;
  - clear `accounts.access_token` / `refresh_token` for `provider = 'github'`.

## Code changes

- `src/lib/github/token.ts`: replace `getGithubToken(userId)` with
  `getRepoToken(repo, permissions)`. It returns an installation token when
  `repo.installationId` is set and falls back to the OAuth token during the
  transition. Every caller in the table above switches to it.
- `src/lib/github.ts` `listGithubRepos`: list
  `GET /user/installations/{id}/repositories` for each of the user's
  installations.
- New `src/app/api/github/app/setup/route.ts` (install callback with the
  ownership check) and `src/app/api/github/app/webhook/route.ts`. The webhook
  route uses one secret, `GITHUB_APP_WEBHOOK_SECRET`, and handles:
  - `installation` created / deleted / suspended / unsuspended: link the
    installation, or disable its repos and cancel their queued runs;
  - `installation_repositories` added / removed: update which repos are
    connected;
  - `push` and `pull_request`: the existing guard logic, minus the per-repo
    secret lookup.
- `src/lib/guard/service.ts`: turning the guard on or off becomes a database
  flag (`guard_enabled_at`); no webhook is created. The admin-access
  requirement goes away.
- Worker: add `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to the Actions
  secrets and the worker env (`audit-worker.yml`), and to Vercel for the web
  routes that mint tokens.
- `src/lib/auth.ts`: the client id/secret become the app's; the `repo` scope
  goes.
- `.env.example`: add the three new variables and keep `AUTH_GITHUB_*`
  pointing at the app.

## Rollout

1. **Register the apps** (manual, in GitHub settings): permissions and
   events as above, webhook URL `https://<app>/api/github/app/webhook`,
   setup URL `https://<app>/api/github/app/setup`. Generate a private key
   and put it in Vercel and Actions secrets.
2. **Dual path.** Ship the table and column, `getRepoToken` with fallback,
   the setup and webhook routes, and a "Connect with the GitHub App" banner.
   Nothing breaks for existing users.
3. **New users use the app only.** Sign-in moves to the app's credentials
   without `repo`. Repos added through the app get `installation_id`. Guard
   on an app repo uses app events. When a legacy repo moves over, Boswell
   deletes its old per-repo webhook.
4. **Move existing users.** On their next visit, prompt them to install the
   app on their connected repos. A repo still without an installation shows
   *Reconnect* and stops auditing after a cut-off date, announced in the
   app and by email.
5. **Remove the legacy path.** Delete the OAuth fallback and the old webhook
   route, and clear the stored GitHub tokens. Users can then revoke the old
   OAuth App at <https://github.com/settings/applications>; mention this in
   the email.

## Tests to write

- Token minting: JWT claims, narrowing by repo and permission, caching
  until near expiry (fetch mocked).
- Setup callback: links an installation the user owns; refuses one that
  isn't in `GET /user/installations`, and one with a missing or wrong
  `state`.
- App webhook: signature check, each event above, and that a removed repo
  stops queuing guard runs.
- `getRepoToken` fallback order, and that no installation token is ever
  written to the database (scan the insert/update calls in the test).
- Manual: install on a test org with one repo selected. Confirm that an
  audit of that repo works and that a request for an unselected repo is
  refused by GitHub.

## Decisions needed

1. **Fix PRs.** A separate optional *Boswell Fix* app (recommended), or
   Contents: write on the main app?
2. **Guard result.** Keep commit statuses, or move to the Checks API? Checks
   allow richer annotations but need Checks: write and a little more code.
   Keeping statuses is the smaller change.
3. **Cut-off date** for legacy OAuth repos in step 4.
