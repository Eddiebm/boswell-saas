import { and, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { verifyTargets, providerConnections } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto/secrets";

/** Live verification's account B (a normal user), reused to check private pages and admin routes on the live site. */
export async function liveTestAccount(repositoryId: string) {
  const db = requireDb();
  const [target] = await db
    .select()
    .from(verifyTargets)
    .where(and(eq(verifyTargets.repositoryId, repositoryId), eq(verifyTargets.enabled, true)))
    .orderBy(desc(verifyTargets.createdAt))
    .limit(1);
  if (!target) return null;
  try {
    return { loginPath: target.loginPath, email: target.accountBEmail, password: decryptSecret(target.accountBPassword) };
  } catch {
    return null;
  }
}

/** Decrypted provider connections for a repository; ones that can't be decrypted are skipped (and re-entered by the user). */
export async function providerConnectionsFor(repositoryId: string) {
  const db = requireDb();
  const rows = await db.select().from(providerConnections).where(eq(providerConnections.repositoryId, repositoryId));
  return rows.flatMap((row) => {
    try {
      return [{ provider: row.provider as "supabase" | "vercel" | "neon", projectRef: row.projectRef, teamId: row.teamId, token: decryptSecret(row.token) }];
    } catch {
      return [];
    }
  });
}
