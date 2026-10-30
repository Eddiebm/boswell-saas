# Repo health checks

Alongside the engine's audit, the worker runs Boswell's own checks on the
cloned repository (`src/lib/checks/`). They catch problems that are true of
the repo's files rather than a matter of judgement, plus a few
pattern-based ones that are marked **needs review**.

| # | Check | Kind | Confidence |
|---|-------|------|-----------|
| 1 | **Lockfile drift** — `package.json` and `package-lock.json` disagree, so `npm ci` fails | Deterministic | 0.95 |
| 2 | **Vulnerable dependencies** — one finding per vulnerable package (not per advisory), with where it comes from, whether it ships to production (dev-only is shown one level lower), and what fixing it takes | Deterministic (`npm audit`) | 0.95 |
| 3 | **Dependency fix PR** — the non-breaking fixes, applied to the lockfile, opened as a PR on request | Deterministic | — |
| 4 | **Installed but not connected** — Sentry without `instrumentation.ts`, analytics never rendered, a rate limiter never applied, production dependencies nothing imports | File checks | 0.85 (0.6 for "never imported") |
| 5 | **Deploy blockers** — env vars the code reads that no `.env.example`/README/deploy config mentions; a framework pin blocking security fixes | File checks | 0.8–0.9 |
| 6 | **Outbound requests** — possible SSRF in route handlers, server `fetch` with no timeout | Pattern, needs review | 0.5–0.6 |
| 7 | **Secret exposure** — routes returning full rows of tables with password/token columns; secrets in `NEXT_PUBLIC_`/`VITE_` variables | Pattern (0.5); public env var (0.85) | |
| 8 | **Refresh wipes another feature's data** — delete-then-reinsert of a table another file also writes, without scoping the delete to its own rows | Pattern, needs review | 0.45 |
| 10 | **Hidden failures** — empty `catch` blocks and `.catch(() => {})` with no stated reason (ranked higher in payment, login and database code), a `catch` that answers `ok`/`success` without logging, a POST route that casts the request body without validating it. Ordinary fallbacks (parsing text, browser storage, analytics) and any block with a comment giving a reason are skipped | Pattern, needs review | 0.4–0.6 |
| 11 | **Leftovers** — source files nothing imports (framework entry points, scripts, tests and anything a package script or workflow names are skipped; monorepos aren't judged), runs of 5+ commented-out code lines, the same 10 lines in two files | Pattern, needs review | 0.45–0.7 |
| 12 | **Change safety** — no tests, tests that no CI workflow (or build script) runs, payment/login/admin routes no test mentions | Pattern, needs review | 0.5–0.75 |
| 13 | **Loops without a finish line** — `while (true)`/`for (;;)`/model-driven loops (JS, TS, Python) and `setInterval`s that call an AI model or take an action with no counter, deadline or budget; agent step limits set to none or 100+; network retries with no cap (a note) | Pattern, needs review | 0.5–0.7 |
| 9 | **Bugs in pairs** — any finding whose flagged line is copied verbatim into 1–5 other files says where | Annotation | — |

Findings below 0.8 confidence are shown but don't move the health score
until someone confirms them.

## How the dependency fix is made

1. The worker copies **only** `package.json` and `package-lock.json` into an
   empty temp directory. No repository code, `.npmrc`, or scripts come along.
2. It runs `npm audit` and `npm audit fix` there with `--package-lock-only`
   (resolve from the registry, install nothing) and `--ignore-scripts`,
   against a pinned registry (`https://registry.npmjs.org/`).
3. npm gets an allowlisted environment — `PATH`, a throwaway `HOME`, and
   proxy/CA settings. The worker's `DATABASE_URL`, API keys and GitHub
   tokens are never passed through.
4. If a direct dependency is pinned below its patched release and the fix
   is in the same major version (e.g. `"next": "16.2.10"` → `16.4.3`), the pin
   is raised and the lockfile re-resolved the same way.
5. The patched files are audited again. A finding only says "the fix PR
   applies this" when that second audit proves it.

Opening the PR (`POST /api/dependency-fix/pr`, Pro plan) commits the files
to a `boswell/deps-*` branch through the git data API. It refuses if either
file on the default branch has changed since the audit (compared by git blob
sha) — re-run the audit to get a fresh patch.

**Boswell never installs, builds, or tests the repository.** The PR's own CI
is the verification; merge only once it's green. Major-version upgrades are
never applied automatically — they're reported as planned upgrades.

Set `BOSWELL_DEPENDENCY_AUDIT=0` on the worker to skip steps 1–5. The
workers run Node 24 (npm 11); older npm versions crash on some lockfiles,
which surfaces as an INFO finding rather than a failed audit.

## Migration

The checks add one table, `dependency_fixes`. Schema changes are applied to
production automatically by `.github/workflows/db-migrate.yml` when they land
on main (it can also be run by hand from the Actions tab). Locally, use
`npm run db:push`.
