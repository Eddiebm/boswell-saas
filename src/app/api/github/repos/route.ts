import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listGithubRepos } from "@/lib/github";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await listGithubRepos(session.user.id);
  return NextResponse.json({ repos });
}
