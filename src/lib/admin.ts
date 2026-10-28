/**
 * Owner/admin identity.
 *
 * There is no `role` or `isAdmin` column on the `users` table (see
 * src/lib/db/schema.ts) and the previous passwordless owner-bootstrap flow
 * (src/lib/auth/owner-bootstrap.ts, removed) identified the owner by
 * whichever GitHub identity held `GITHUB_BOOTSTRAP_TOKEN`. With that gone,
 * `ADMIN_ALERT_EMAIL` — already used elsewhere as the operator's contact
 * address for audit-failure alerts (see src/lib/alerts/audit-alerts.ts) — is
 * the only remaining signal for "who runs this deployment", so it doubles as
 * the admin allowlist for /dashboard/admin. If it isn't configured, nobody
 * is treated as admin (fail closed) rather than falling back to "any signed
 * in user".
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail || !email) return false;
  return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}
