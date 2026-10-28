import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { repositories } from "@/lib/db/schema";
import { assertSafeStagingUrl } from "@/lib/dynamic-verify/validate-target";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getRepositoryForUser } from "@/lib/repositories";
import { getOptionalUserId } from "@/lib/session";

/** Set or clear the deployed URL Boswell's live checks run against. */
export async function POST(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = rateLimit(`live-url:${clientIp(request)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { repositoryId?: string; url?: string | null };
  if (!body.repositoryId) return NextResponse.json({ error: "repositoryId required" }, { status: 400 });

  let liveUrl: string | null = null;
  if (body.url) {
    try {
      const parsed = new URL(body.url.trim().match(/^https?:\/\//i) ? body.url.trim() : `https://${body.url.trim()}`);
      await assertSafeStagingUrl(parsed.toString());
      liveUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message.replace(/stagingUrl/g, "URL") : "Invalid URL" }, { status: 400 });
    }
  }
  if (isDemoMode()) return NextResponse.json({ ok: true, liveUrl });

  const repo = await getRepositoryForUser(userId, body.repositoryId);
  if (!repo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = requireDb();
  await db.update(repositories).set({ liveUrl }).where(eq(repositories.id, repo.id));
  return NextResponse.json({ ok: true, liveUrl });
}
