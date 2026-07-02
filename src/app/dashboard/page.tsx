export const dynamic = "force-dynamic";

import Link from "next/link";
import { auth } from "@/lib/auth";
import { listAuditsForUser } from "@/lib/audits";
import { listRepositoriesForUser } from "@/lib/repositories";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPlanLimits, type PlanId } from "@/lib/plans";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { Card } from "@/components/ui";
import { SyncReposButton } from "@/components/sync-repos-button";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const plan = (user?.plan ?? "free") as PlanId;
  const limits = getPlanLimits(plan);
  const repos = await listRepositoriesForUser(userId);
  const audits = await listAuditsForUser(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-zinc-400">
          Plan: {limits.name} · {user?.auditsUsedThisMonth ?? 0}/{limits.auditsPerMonth} audits
          this month
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-zinc-400">Repositories</p>
          <p className="mt-2 text-3xl font-semibold">{repos.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Audits</p>
          <p className="mt-2 text-3xl font-semibold">{audits.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Plan limit</p>
          <p className="mt-2 text-3xl font-semibold">{limits.maxRepos} repos</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Get started</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Sync repositories from GitHub, then run your first audit.
            </p>
          </div>
          <SyncReposButton />
        </div>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Recent audits</h2>
          <Link href="/dashboard/audits" className="text-sm text-zinc-400 hover:text-white">
            View all
          </Link>
        </div>
        <div className="space-y-3">
          {audits.slice(0, 5).map((audit) => (
            <Card key={audit.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-medium">{audit.repoFullName}</p>
                <p className="text-sm text-zinc-400">{audit.summary ?? "Queued audit"}</p>
              </div>
              <div className="flex items-center gap-3">
                <AuditStatusBadge status={audit.status} />
                <Link href={`/dashboard/audits/${audit.id}`} className="text-sm underline">
                  Open
                </Link>
              </div>
            </Card>
          ))}
          {audits.length === 0 ? (
            <p className="text-sm text-zinc-500">No audits yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
