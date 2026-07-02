import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { askBrain } from "@/lib/data";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { question?: string; repositoryId?: string };
  if (!body.question?.trim()) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const result = await askBrain(session.user.id, body.question.trim(), body.repositoryId);
  return NextResponse.json(result);
}
