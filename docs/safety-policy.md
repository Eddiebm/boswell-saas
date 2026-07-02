# Safety policy

## Automation tiers

| Tier | Meaning | Examples |
|------|---------|----------|
| **Green** | Safe to open PR | Dead imports, docs, unused files, formatting |
| **Yellow** | Patch proposal, human approval | Refactors, renames, dependency bumps |
| **Red** | Manual only | Auth, payments, crypto, DB migrations, permissions |

## Non-negotiable rules

1. **Never push to main**
2. **Never auto-merge**
3. **Evil classification** requires strong evidence (secrets, bypass auth, RCE patterns)
4. **PRs include rollback notes** and link to originating finding
5. **Repo code** processed in ephemeral worker workspace, cleaned after job

## Classification

- **Good** — patterns to preserve
- **Bad** — messy but not urgent
- **Dangerous** — security, reliability, or money risk
- **Evil** — rare; business-critical harm potential

Implemented in `src/lib/classification/classify.ts` and `src/lib/automation/safe-fix-policy.ts`.
