export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { ScoreGauge } from "@/components/score-gauge";
import { getRepositories, getRepoScore, getSlop } from "@/lib/data";
import { RunAuditButton } from "@/components/run-audit-button";

export default async function ReposPage() {
  const repos = await getRepositories("demo-user");
  const enriched = await Promise.all(
    repos.map(async (repo) => ({
      repo,
      score: await getRepoScore(repo.id),
      slop: await getSlop(repo.id),
    })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Repositories</h1>
        <p className="mt-2 text-zinc-400">Health scores and slop levels for each watched repo.</p>
      </div>

      <div className="grid gap-4">
        {enriched.map(({ repo, score, slop }) => (
          <Card key={repo.id} className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
            <div>
              <Link href={`/dashboard/repos/${repo.id}`} className="text-lg font-medium hover:underline">
                {repo.fullName}
              </Link>
              <p className="mt-1 text-sm text-zinc-400">{repo.description}</p>
            </div>
            <ScoreGauge score={score?.overall ?? repo.healthScore ?? 0} label="Health" />
            <div className="text-center">
              <p className="text-xs text-zinc-500">AI Slop</p>
              <p className="text-2xl font-semibold">{slop.overallPercent}%</p>
            </div>
            <div className="flex flex-col gap-2">
              <RunAuditButton repositoryId={repo.id} />
              <Link href={`/dashboard/repos/${repo.id}`} className="text-center text-sm underline">
                Details
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
