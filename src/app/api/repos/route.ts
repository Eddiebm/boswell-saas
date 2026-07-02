import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listRepositoriesForUser, syncRepositoriesForUser } from "@/lib/repositories";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await listRepositoriesForUser(session.user.id);
  return NextResponse.json({ repos });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    githubIds?: number[];
  };

  const result = await syncRepositoriesForUser(session.user.id, body.githubIds);
  return NextResponse.json(result);
}
