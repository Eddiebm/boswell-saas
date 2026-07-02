import { and, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { repositories, users } from "@/lib/db/schema";
import { listGithubRepos } from "@/lib/github";
import { getPlanLimits, type PlanId } from "@/lib/plans";

export async function syncRepositoriesForUser(userId: string, selectedGithubIds?: number[]) {
  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  const plan = (user.plan ?? "free") as PlanId;
  const limits = getPlanLimits(plan);
  const remoteRepos = await listGithubRepos(userId);

  const toSync =
    selectedGithubIds && selectedGithubIds.length
      ? remoteRepos.filter((r) => selectedGithubIds.includes(r.githubId))
      : remoteRepos.slice(0, limits.maxRepos);

  const existing = await db
    .select()
    .from(repositories)
    .where(eq(repositories.userId, userId));

  const existingIds = new Set(existing.map((r) => r.githubId));
  const inserted = [];

  for (const repo of toSync) {
    if (existingIds.has(repo.githubId)) continue;
    if (existing.length + inserted.length >= limits.maxRepos) break;

    const [row] = await db
      .insert(repositories)
      .values({
        userId,
        githubId: repo.githubId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
        description: repo.description ?? undefined,
      })
      .returning();
    inserted.push(row);
  }

  return {
    synced: inserted.length,
    total: existing.length + inserted.length,
    limit: limits.maxRepos,
  };
}

export async function listRepositoriesForUser(userId: string) {
  const db = requireDb();
  return db.select().from(repositories).where(eq(repositories.userId, userId));
}

export async function getRepositoryForUser(userId: string, repositoryId: string) {
  const db = requireDb();
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
    .limit(1);
  return repo ?? null;
}
