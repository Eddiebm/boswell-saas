import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/mode";
import { setPrimaryRepository } from "@/lib/data";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, message: "Demo mode uses a fixed repository." });
  }

  const body = (await request.json()) as { repositoryId?: string };
  if (!body.repositoryId) {
    return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
  }

  try {
    await setPrimaryRepository(session.user.id, body.repositoryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to set primary repository";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
