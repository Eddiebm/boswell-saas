import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { repositories, users } from "@/lib/db/schema";
import { disableGuard, enableGuard } from "@/lib/guard/service";
import { canUsePrAutomation, type PlanId } from "@/lib/plans";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getRepositoryForUser } from "@/lib/repositories";
import { getOptionalUserId } from "@/lib/session";

/** Turn the push guard on or off for one repository. */
export async function POST(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`guard:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { repositoryId?: string; enabled?: boolean };
  if (!body.repositoryId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "repositoryId and enabled required" }, { status: 400 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ ok: true, enabled: body.enabled, message: "Demo mode — guard simulated." });
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!canUsePrAutomation((user?.plan ?? "free") as PlanId)) {
    return NextResponse.json({ error: "The push guard requires the Pro plan." }, { status: 403 });
  }
  const owned = await getRepositoryForUser(userId, body.repositoryId);
  if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, owned.id)).limit(1);
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  try {
    if (body.enabled) {
      if (repo.guardWebhookId) return NextResponse.json({ ok: true, enabled: true });
      await enableGuard(userId, repo);
      return NextResponse.json({ ok: true, enabled: true, message: "Guard on. Boswell will check every push to the default branch and every pull request." });
    }
    await disableGuard(userId, repo);
    return NextResponse.json({ ok: true, enabled: false, message: "Guard off. The webhook was removed from GitHub." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub request failed";
    const status = (error as { status?: number }).status;
    return NextResponse.json(
      { error: status === 403 || status === 404 ? "Boswell can't manage webhooks on this repository — you need admin access to it." : message },
      { status: 502 },
    );
  }
}
