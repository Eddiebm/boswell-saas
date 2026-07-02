import { NextResponse } from "next/server";
import { askBrain } from "@/lib/data";

export async function POST(request: Request) {
  const body = (await request.json()) as { question?: string };
  if (!body.question?.trim()) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  const result = await askBrain("demo-user", body.question.trim());
  return NextResponse.json(result);
}
