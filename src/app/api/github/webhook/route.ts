import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { repositories } from "@/lib/db/schema";
import { getGithubClient } from "@/lib/github";
import { guardSecretFor, postStatus, queueGuardRun } from "@/lib/guard/service";
import { guardTarget, verifySignature } from "@/lib/guard/webhook";

/**
 * GitHub push / pull_request events for repositories with the push guard on.
 * Each repository's webhook has its own secret; the hook id GitHub sends
 * tells us which one to verify against.
 */
export async function POST(request: Request) {
  const hookId = Number(request.headers.get("x-github-hook-id"));
  const event = request.headers.get("x-github-event");
  const rawBody = await request.text();
  if (!Number.isSafeInteger(hookId) || hookId <= 0) {
    return NextResponse.json({ error: "Missing hook id" }, { status: 400 });
  }

  const db = requireDb();
  const [repo] = await db.select().from(repositories).where(eq(repositories.guardWebhookId, hookId)).limit(1);
  let secret: string | null = null;
  try {
    secret = repo ? guardSecretFor(repo) : null;
  } catch {
    // Undecryptable secret (e.g. AUTH_SECRET rotated): fail closed; turning the guard off and on again re-keys it.
  }
  if (!repo || !secret || !verifySignature(secret, rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (event === "ping") return NextResponse.json({ ok: true });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if ((payload as { repository?: { id?: number } }).repository?.id !== repo.githubId) {
    return NextResponse.json({ error: "Repository mismatch" }, { status: 400 });
  }
  const target = guardTarget(event, payload, repo.defaultBranch);
  if (!target) return NextResponse.json({ ok: true, ignored: true });

  await queueGuardRun(repo, target);
  try {
    const gh = await getGithubClient(repo.userId);
    await postStatus(gh, repo, target.sha, "pending", "Boswell is checking this commit for launch blockers");
  } catch {
    /* the final status still lands when the run completes */
  }
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}
