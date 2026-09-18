export const dynamic = "force-dynamic";

import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Badge, Card } from "@/components/ui";
import { UpgradeButton } from "@/components/upgrade-button";
import { VerifyTargetForm } from "@/components/verify-target-form";
import { VerifyRunButton } from "@/components/verify-run-button";
import { getPrimaryRepoId, getPrimaryRepository } from "@/lib/data";
import { requireUserId } from "@/lib/session";
import { isDemoMode } from "@/lib/demo/mode";
import { canUseDynamicVerify, type PlanId } from "@/lib/plans";
import { getDiscoveredCandidates, listVerifyRuns, listVerifyTargets } from "@/lib/dynamic-verify/run";

const RESULT_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  leak_confirmed: "bad",
  no_leak: "good",
  inconclusive: "warn",
  queued: "neutral",
  running: "neutral",
  failed: "warn",
};

export default async function VerifyPage() {
  const userId = await requireUserId();
  let plan: PlanId = "free";
  if (isDemoMode()) {
    // Demo mode showcases every plan tier's features, same as the brain/executive pages.
    plan = "pro";
  } else {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    plan = (user?.plan ?? "free") as PlanId;
  }
  const allowed = canUseDynamicVerify(plan);

  const primaryRepoId = await getPrimaryRepoId(userId);
  const primaryRepo = await getPrimaryRepository(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Live access-control verification</h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Beta. Proves — against a real, running staging instance, not by reading source — whether
          one account can read another account&apos;s data. Staging only, read-only, no new
          accounts created.
        </p>
        {primaryRepo ? (
          <p className="mt-2 text-sm text-zinc-500">
            Configured for <span className="text-zinc-300">{primaryRepo.fullName}</span> — change
            via the repo selector in the header.
          </p>
        ) : null}
      </div>

      {!allowed ? (
        <Card className="space-y-3">
          <p className="text-zinc-300">This feature requires the Pro plan.</p>
          <UpgradeButton plan="pro" />
        </Card>
      ) : !primaryRepoId ? (
        <Card>
          <p className="text-zinc-300">Connect and select a primary repository first.</p>
        </Card>
      ) : (
        <VerifyPageBody userId={userId} repositoryId={primaryRepoId} />
      )}
    </div>
  );
}

async function VerifyPageBody({ userId, repositoryId }: { userId: string; repositoryId: string }) {
  const targets = await listVerifyTargets(userId, repositoryId);
  const runsByTarget = await Promise.all(
    targets.map(async (target) => ({ target, runs: await listVerifyRuns(userId, target.id) })),
  );
  const discovery = await getDiscoveredCandidates(userId, repositoryId);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-4 text-xl font-medium">Add a target</h2>
        <VerifyTargetForm
          repositoryId={repositoryId}
          loginCandidates={discovery.loginCandidates}
          resourceCandidates={discovery.resourceCandidates}
        />
      </Card>

      {runsByTarget.map(({ target, runs }) => (
        <Card key={target.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-medium">{target.label}</h3>
              <p className="text-sm text-zinc-500">
                {target.stagingUrl} · {target.resourcePathTemplate}
              </p>
            </div>
            <VerifyRunButton targetId={target.id} />
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-zinc-500">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge tone={RESULT_TONE[run.result ?? run.status] ?? "neutral"}>
                    {run.result ?? run.status}
                  </Badge>
                  <span className="text-zinc-400">{run.summary ?? run.error ?? "…"}</span>
                  <span className="text-zinc-600">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
