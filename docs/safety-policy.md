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

## Live access-control verification (beta)

Boswell can prove — not just infer from source — whether one account can read
another account's data, by logging into a customer-supplied staging target
with two test accounts and issuing a single read-only request.

1. **Staging only.** A target requires explicit `consentConfirmed` before it
   can be created; there is no automated way to point it at a production URL.
2. **Never creates accounts.** The customer supplies two accounts they
   already own. Boswell never signs up, emails, or otherwise touches a real
   user.
3. **Read-only against the target.** The only mutating request the engine
   makes is the login itself; the resource check is always a GET. Enforced
   by `src/lib/dynamic-verify/security-invariants.test.ts`.
4. **No raw response persisted.** Only an HTTP status, a list of which
   known-sensitive fields (if any) leaked, and a short summary are stored —
   never the response body.
5. **Pro plan only**, gated by `canUseDynamicVerify`.
6. A confirmed leak is `CRITICAL` severity and lands in the Fix Queue as
   **manual only** (`canAutoPr: false`) — broken auth is Red-tier per the
   automation table above, so Boswell never opens a PR for it automatically.

### Autodiscovery — what's inferred vs. what's supplied

`src/lib/dynamic-verify/discover.ts` runs as a pure static analyzer over the
same file walk already produced for the AI Slop scanner during a normal
audit — no extra clone, no network call (enforced by the same invariants
test). It can only suggest **where** to check:

- A likely login endpoint, from a `POST` route handler that references
  passwords/credentials.
- Candidate per-resource `GET` routes with a dynamic id segment, ranked
  `high` confidence when no ownership check is visible in the handler and
  `low` when one already is.

It cannot discover **who** to check with. Test-account credentials and a
concrete resource id are runtime data that doesn't exist in source, so
those always stay customer-supplied — autodiscovery narrows the setup form
to picking suggested routes, it never lowers the consent or account-
provisioning bar above.

Implemented in `src/lib/dynamic-verify/`.

## Classification

- **Good** — patterns to preserve
- **Bad** — messy but not urgent
- **Dangerous** — security, reliability, or money risk
- **Evil** — rare; business-critical harm potential

Implemented in `src/lib/classification/classify.ts` and `src/lib/automation/safe-fix-policy.ts`.
