export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPlanLimits, type PlanId } from "@/lib/plans";
import { publicPlanSummary } from "@/lib/stripe";
import { Card } from "@/components/ui";
import { UpgradeButton } from "@/components/upgrade-button";

export default async function BillingPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const plan = (user?.plan ?? "free") as PlanId;
  const limits = getPlanLimits(plan);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Billing</h1>
        <p className="mt-2 text-zinc-400">
          Current plan: {limits.name} · {user?.auditsUsedThisMonth ?? 0}/{limits.auditsPerMonth}{" "}
          audits used this month
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {publicPlanSummary().map((item) => (
          <Card key={item.id} className={item.id === plan ? "border-white/30" : undefined}>
            <h2 className="text-xl font-medium">{item.name}</h2>
            <p className="mt-2 text-3xl font-semibold">
              {item.priceMonthly === 0 ? "Free" : `$${item.priceMonthly}/mo`}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-zinc-400">
              {item.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
            <div className="mt-6">
              {item.id === "pro" && plan === "free" ? <UpgradeButton plan="pro" /> : null}
              {item.id === "team" && plan !== "team" ? <UpgradeButton plan="team" /> : null}
              {item.id === plan ? <p className="text-sm text-emerald-300">Current plan</p> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
