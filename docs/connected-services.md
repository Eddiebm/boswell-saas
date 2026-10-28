# Connected services

Some launch checks only exist in dashboards: whether row level security is
really on in the live database, whether backups exist, whether production
has every setting. On **Ship Ready → Connected services** a user can give
Boswell read-only access per repository; every full audit then checks them.

| Provider | Token | Calls (all reads) | Findings |
|---|---|---|---|
| Supabase | Personal access token (can't be scoped to read-only — Boswell only reads) | `GET /v1/projects/{ref}`, `POST /v1/projects/{ref}/database/query/read-only` (read-only role; queries `pg_class.relrowsecurity` for public tables), `GET /v1/projects/{ref}/database/backups` | `ops.db-paused`, `db.rls-disabled` (proven, 0.98), `ops.no-backups` |
| Vercel | Account token scoped to the team | `GET /v10/projects/{id}/env?decrypt=false` (names and targets only), `GET /v7/deployments?target=production&limit=1` | `deploy.env-missing-prod` (env vars the app's code reads that production lacks — scripts and tests excluded), `ops.deploy-failing` |
| Neon | API key (project-scoped where available) | `GET /projects/{id}` (history retention), `GET /projects/{id}/branches`, `GET /projects/{id}/advisors?category=SECURITY&min_severity=ERROR` | `ops.no-backups`, `ops.short-backups` (< 24h restore window), `ops.branch-unprotected`, `db.rls-disabled` / `db.neon-advisor` |

Response shapes follow each provider's published SDK types
(`supabase-management-js`, `@vercel/sdk`, `@neondatabase/api-client`).
Unexpected or failed responses produce a "Couldn't read <provider>" note,
never a pass.

Tokens are validated with one read when saved, stored encrypted
(`src/lib/crypto/secrets.ts`), and deleted on disconnect (users should also
revoke them with the provider).

Ship Ready coverage: a connected Supabase project makes "The database
rejects strangers" a verified check; Supabase/Neon make "Database backups
are on" verifiable instead of "confirm yourself"; Vercel adds production
env verification to "Every setting the app needs is documented and set".

## Static database checks (no connection needed)

For apps whose database is meant to be reached only from the server (Neon,
plain Postgres, Prisma, Mongo…):

- `db.client-database` — a database driver imported in a client component
  (the connection string would have to ship to the browser),
- `db.ssl-disabled` — `sslmode=disable` in a connection string,
- `db.not-pooled` — Neon's direct endpoint with a TCP driver on serverless
  (review),
- Apps using Neon's Data API get the same RLS check on SQL migrations as
  Supabase apps.

Migration: new table `provider_connections`.
