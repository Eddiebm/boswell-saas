import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { fixQueueItems, pullRequests, repositories, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getRepositoryForUser } from "@/lib/repositories";
import { createSafeFixPullRequest } from "@/lib/github/pr";
import { canUsePrAutomation } from "@/lib/plans";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { PlanId } from "@/lib/plans";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`pr:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      ok: true,
      message: "Demo mode — PR simulated.",
      prUrl: "https://github.com/example/repo/pull/1",
    });
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const plan = (user?.plan ?? "free") as PlanId;
  if (!canUsePrAutomation(plan)) {
    return NextResponse.json(
      { error: "PR automation requires Team plan or higher." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { itemId?: string };
  if (!body.itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  const [item] = await db
    .select()
    .from(fixQueueItems)
    .where(eq(fixQueueItems.id, body.itemId))
    .limit(1);

  if (!item) {
    return NextResponse.json({ error: "Fix queue item not found" }, { status: 404 });
  }

  const repo = await getRepositoryForUser(session.user.id, item.repositoryId);
  if (!repo) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!item.canAutoPr) {
    return NextResponse.json(
      { error: "This item requires human review before Boswell can open a PR." },
      { status: 400 },
    );
  }

  const [fullRepo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repo.id))
    .limit(1);

  if (!fullRepo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  try {
    const result = await createSafeFixPullRequest({
      userId: session.user.id,
      owner: fullRepo.owner,
      repo: fullRepo.name,
      defaultBranch: fullRepo.defaultBranch,
      title: item.title,
      body: item.whyItMatters,
      suggestedFix: item.suggestedFix,
      files: (item.files as string[]) ?? [],
      fixQueueItemId: item.id,
      rollbackNote: "Revert merge of the boswell/safe-fix branch or close the PR without merging.",
    });

    await db.insert(pullRequests).values({
      repositoryId: fullRepo.id,
      fixQueueItemId: item.id,
      branch: result.branch,
      title: `[Boswell] ${item.title}`,
      body: item.suggestedFix,
      riskLevel: "green",
      rollbackNote: "Close PR or revert branch to undo.",
      githubPrNumber: result.prNumber,
      githubPrUrl: result.prUrl,
      status: "open",
    });

    return NextResponse.json({
      ok: true,
      message: "Safe-fix PR opened on a branch (never pushed to main).",
      prUrl: result.prUrl,
      branch: result.branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub PR failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
