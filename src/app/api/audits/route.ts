import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAuditsForUser, queueAudit } from "@/lib/audits";
import { isAuditMode, normalizeAuditMode } from "@/lib/audit-modes";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const auditRequestSchema = z.object({
  repositoryId: z.string().uuid(),
  auditMode: z.string().optional(),
  retestOfAuditId: z.string().uuid().optional(),
}).strict();

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

  const rl = rateLimit(`audit:${session.user.id}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (Number(request.headers.get("content-length") ?? 0) > 10_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  const parsed = auditRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid audit request" }, { status: 400 });
  }
  const body = parsed.data;

  if (body.auditMode && !isAuditMode(body.auditMode)) {
    return NextResponse.json({ error: "auditMode must be quick, standard, or deep" }, { status: 400 });
  }

  try {
    const run = await queueAudit(
      session.user.id,
      body.repositoryId,
      body.auditMode ? normalizeAuditMode(body.auditMode) : "standard",
      body.retestOfAuditId,
    );
    return NextResponse.json({
      audit: run,
      message: "Audit queued. Ensure npm run worker is running to process it.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue audit";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
