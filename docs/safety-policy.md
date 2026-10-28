# Safety policy

## Automation tiers

| Tier | Meaning | Examples |
|------|---------|----------|
| **Green** | Safe to open PR | Dead imports, docs, unused files, formatting |
| **Yellow** | Patch proposal, human approval | Refactors, renames, dependency bumps (the dependency fix PR is opened only on request, never merged) |
| **Red** | Manual only | Auth, payments, crypto, DB migrations, permissions |

## Non-negotiable rules

1. **Never push to main**
2. **Never auto-merge**
3. **Evil classification** requires strong evidence (secrets, bypass auth, RCE patterns)
4. **PRs include rollback notes** and link to originating finding
5. **Repo code** processed in ephemeral worker workspace, cleaned after job
6. **Never execute the audited repository.** No install, build, test, or package scripts. The only process run on its behalf is npm on copies of `package.json`/`package-lock.json` in an isolated directory with `--package-lock-only --ignore-scripts`, a pinned registry, and none of the worker's secrets in its environment (see [repo-checks.md](repo-checks.md)). Enforced by `src/lib/checks/security-invariants.test.ts`.
7. **Dependency fix PRs** contain only non-breaking fixes, refuse to open if the lockfile changed since the audit, and rely on the target repo's CI for verification

## Classification

- **Good** — patterns to preserve
- **Bad** — messy but not urgent
- **Dangerous** — security, reliability, or money risk
- **Evil** — rare; business-critical harm potential

Implemented in `src/lib/classification/classify.ts` and `src/lib/automation/safe-fix-policy.ts`.
