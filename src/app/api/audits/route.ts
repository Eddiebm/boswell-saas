import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAuditsForUser, queueAudit } from "@/lib/audits";
import { processWorkerTick } from "@/lib/audits";

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

  const body = (await request.json()) as { repositoryId?: string };
  if (!body.repositoryId) {
    return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
  }

  try {
    const run = await queueAudit(session.user.id, body.repositoryId);
    void processWorkerTick();
    return NextResponse.json({ audit: run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue audit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
