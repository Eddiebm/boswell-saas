import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { fixQueueItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getRepositoryForUser } from "@/lib/repositories";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      ok: true,
      message: "Demo mode — PR creation simulated. Connect GitHub for real PRs.",
      prUrl: "https://github.com/example/repo/pull/0",
    });
  }

  const form = await request.formData();
  const itemId = form.get("itemId");
  if (!itemId || typeof itemId !== "string") {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  const db = requireDb();
  const [item] = await db
    .select()
    .from(fixQueueItems)
    .where(eq(fixQueueItems.id, itemId))
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

  // Real PR flow: branch + commit + GitHub API — never push to main (pending GitHub App)
  return NextResponse.json({
    ok: true,
    message: "PR workflow queued (stub). Wire GitHub API to create branch and open PR.",
    itemId,
    repositoryId: item.repositoryId,
  });
}
