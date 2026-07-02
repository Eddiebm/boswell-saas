import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { askBrain } from "@/lib/data";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`brain:${session.user.id}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = (await request.json()) as { question?: string; repositoryId?: string };
  if (!body.question?.trim()) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const result = await askBrain(session.user.id, body.question.trim(), body.repositoryId);
  return NextResponse.json(result);
}
