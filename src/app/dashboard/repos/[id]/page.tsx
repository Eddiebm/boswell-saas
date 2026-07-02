export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { DimensionBars, ScoreGauge } from "@/components/score-gauge";
import { CoachingCard } from "@/components/coaching-card";
import { RunAuditButton } from "@/components/run-audit-button";
import {
  getRepository,
  getRepoScore,
  getSlop,
  getFindings,
  getScoreHistory,
  getFixQueue,
} from "@/lib/data";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { requireUserId } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export default async function RepoDetailPage({ params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const repo = await getRepository(userId, id);
  if (!repo) notFound();

  const score = await getRepoScore(id);
  const slop = await getSlop(id);
  const findings = await getFindings(id);
  const history = await getScoreHistory(id);
  const fixQueue = await getFixQueue(id);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{repo.fullName}</h1>
          <p className="mt-2 text-zinc-400">{repo.description}</p>
        </div>
        <RunAuditButton repositoryId={id} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ScoreGauge score={score?.overall ?? 0} />
        <Card>
          <p className="text-sm text-zinc-400">AI Slop Score</p>
          <p className="mt-2 text-4xl font-semibold">{slop.overallPercent}%</p>
          <p className="mt-2 text-xs text-zinc-500">
            Human review confidence: {slop.humanReviewConfidence}%
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Open fix queue</p>
          <p className="mt-2 text-4xl font-semibold">{fixQueue.length}</p>
          <Link href="/dashboard/fix-queue" className="mt-2 inline-block text-sm underline">
            View queue
          </Link>
        </Card>
      </div>

      {score ? (
        <Card>
          <h2 className="mb-4 text-lg font-medium">Health dimensions</h2>
          <DimensionBars dimensions={score.dimensions} />
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-4 text-lg font-medium">Technical debt timeline</h2>
        <div className="grid gap-2 md:grid-cols-4">
          {history.map((snap, i) => (
            <div key={`${String(snap.snapshotAt)}-${i}`} className="rounded-lg bg-zinc-900 p-3 text-sm">
              <p className="text-zinc-500">{String(snap.snapshotAt)}</p>
              <p className="mt-1 text-xl font-semibold">{snap.overall}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-zinc-400">
          {history.length >= 2 && history[0].overall < history[history.length - 1].overall
            ? "Trend: deteriorating — prioritize security and testing."
            : "Trend: stable or improving — keep clearing recurring findings."}
        </p>
      </Card>

      {slop.topCauses.length ? (
        <section className="space-y-4">
          <h2 className="text-xl font-medium">AI Slop — top causes</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {slop.topCauses.map((cause) => (
              <Card key={cause.id}>
                <div className="flex items-center justify-between">
                  <p className="font-medium">{cause.label}</p>
                  <Badge tone="warn">{cause.count}</Badge>
                </div>
                <p className="mt-2 text-xs text-zinc-500">{cause.files.slice(0, 3).join(", ")}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {findings.length ? (
        <section className="space-y-4">
          <h2 className="text-xl font-medium">Top findings (coached)</h2>
          {findings.slice(0, 3).map((f) => (
            <CoachingCard key={f.id} title={f.title} coaching={f.coaching as CoachingSections} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
