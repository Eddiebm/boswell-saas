import { NextResponse } from "next/server";
import { getOptionalUserId } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { listVerifyRuns, queueVerifyRun } from "@/lib/dynamic-verify/run";
import { triggerAuditWorkerDispatch } from "@/lib/worker/trigger-worker";
import { isDemoMode } from "@/lib/demo/mode";

export async function GET(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetId = new URL(request.url).searchParams.get("targetId");
  if (!targetId) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }

  const runs = await listVerifyRuns(userId, targetId);
  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`verify-run:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = (await request.json()) as { targetId?: string };
  if (!body.targetId) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }

  try {
    const run = await queueVerifyRun(userId, body.targetId);
    if (!isDemoMode()) {
      void triggerAuditWorkerDispatch().catch(() => {
        /* cron fallback */
      });
    }
    return NextResponse.json({
      run,
      message: "Verification run queued. Ensure npm run worker is running to process it.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue verification run";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
