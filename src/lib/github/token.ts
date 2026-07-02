import { and, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

export async function getGithubToken(userId: string): Promise<string | null> {
  const db = requireDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
    .limit(1);

  return account?.access_token ?? null;
}
