import { NextResponse } from "next/server";
import { processWorkerTick } from "@/lib/audits";

export async function POST(request: Request) {
  const secret = request.headers.get("x-worker-secret");
  if (!secret || secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processWorkerTick();
  return NextResponse.json(result);
}
