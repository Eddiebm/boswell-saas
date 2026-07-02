import { NextResponse } from "next/server";
import { processWorkerTick } from "@/lib/audits";

export async function POST(request: Request) {
  const headerSecret = request.headers.get("x-worker-secret");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const secret = headerSecret ?? querySecret;
  if (!secret || secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processWorkerTick();
  return NextResponse.json(result);
}
