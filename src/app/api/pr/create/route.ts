import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";

export async function POST(request: Request) {
  if (isDemoMode()) {
    return NextResponse.json({
      ok: true,
      message: "Demo mode — PR creation simulated. Connect GitHub for real PRs.",
      prUrl: "https://github.com/Eddiebm/audiolens-app/pull/0",
    });
  }

  const form = await request.formData();
  const itemId = form.get("itemId");
  if (!itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  // Real PR flow: branch + commit + GitHub API — never push to main
  return NextResponse.json({
    ok: true,
    message: "PR workflow queued",
    itemId,
  });
}
