import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { dependencyFixes, pullRequests, repositories, users } from "@/lib/db/schema";
import { getRepositoryForUser } from "@/lib/repositories";
import { getGithubClient } from "@/lib/github";
import { createDependencyFixPullRequest, StaleDependencyFixError } from "@/lib/github/dependency-pr";
import { canUsePrAutomation, type PlanId } from "@/lib/plans";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getOptionalUserId } from "@/lib/session";

export async function POST(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`dependency-pr:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      ok: true,
      message: "Demo mode — dependency fix PR simulated.",
      prUrl: "https://github.com/example/repo/pull/2",
    });
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!canUsePrAutomation((user?.plan ?? "free") as PlanId)) {
    return NextResponse.json({ error: "Dependency fix PRs require the Pro plan." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { fixId?: string };
  if (!body.fixId) {
    return NextResponse.json({ error: "fixId required" }, { status: 400 });
  }

  const [fix] = await db.select().from(dependencyFixes).where(eq(dependencyFixes.id, body.fixId)).limit(1);
  if (!fix) {
    return NextResponse.json({ error: "Dependency fix not found" }, { status: 404 });
  }
  const repo = await getRepositoryForUser(userId, fix.repositoryId);
  if (!repo) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (fix.status === "pr_opened" && fix.prUrl) {
    return NextResponse.json({ ok: true, message: "PR already open.", prUrl: fix.prUrl });
  }
  if (fix.status !== "ready") {
    return NextResponse.json({ error: "A newer audit replaced this fix. Use the latest audit's fix." }, { status: 409 });
  }

  const [fullRepo] = await db.select().from(repositories).where(eq(repositories.id, repo.id)).limit(1);
  if (!fullRepo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  try {
    const result = await createDependencyFixPullRequest({
      octokit: await getGithubClient(userId),
      owner: fullRepo.owner,
      repo: fullRepo.name,
      defaultBranch: fullRepo.defaultBranch,
      fix,
    });

    await db
      .update(dependencyFixes)
      .set({ status: "pr_opened", prUrl: result.prUrl })
      .where(and(eq(dependencyFixes.id, fix.id), eq(dependencyFixes.status, "ready")));
    await db.insert(pullRequests).values({
      repositoryId: fullRepo.id,
      branch: result.branch,
      title: result.title,
      body: `Lockfile-only dependency fix (${fix.changes.length} package changes).`,
      riskLevel: "green",
      rollbackNote: "Close the PR, or revert its merge commit.",
      githubPrNumber: result.prNumber,
      githubPrUrl: result.prUrl,
      status: "open",
    });

    return NextResponse.json({
      ok: true,
      message: "Dependency fix PR opened on a branch (never pushed to main). Merge once your CI passes.",
      prUrl: result.prUrl,
      branch: result.branch,
    });
  } catch (error) {
    if (error instanceof StaleDependencyFixError) {
      await db
        .update(dependencyFixes)
        .set({ status: "stale", patchedLockfile: "", patchedPackageJson: null })
        .where(eq(dependencyFixes.id, fix.id));
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "GitHub PR failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
