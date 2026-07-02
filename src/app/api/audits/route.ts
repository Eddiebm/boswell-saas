import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAuditsForUser, queueAudit } from "@/lib/audits";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const audits = await listAuditsForUser(session.user.id);
  return NextResponse.json({ audits });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`audit:${clientIp(request)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = (await request.json()) as { repositoryId?: string };
  if (!body.repositoryId) {
    return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
  }

  try {
    const run = await queueAudit(session.user.id, body.repositoryId);
    return NextResponse.json({
      audit: run,
      message: "Audit queued. Ensure npm run worker is running to process it.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue audit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
