import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getPlanLimits, type PlanId } from "@/lib/plans";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const plan = (user.plan ?? "free") as PlanId;
  const limits = getPlanLimits(plan);

  return NextResponse.json({
    plan,
    limits,
    usage: {
      auditsUsedThisMonth: user.auditsUsedThisMonth ?? 0,
      auditMonthKey: user.auditMonthKey,
    },
  });
}
