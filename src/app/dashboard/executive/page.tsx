export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { ScoreGauge, DimensionBars } from "@/components/score-gauge";
import {
  getDashboardBriefing,
  getRepositories,
  getRepoScore,
  getSlop,
  getPrimaryRepoId,
} from "@/lib/data";
import { requireUserId } from "@/lib/session";

export default async function ExecutivePage() {
  const userId = await requireUserId();
  const briefing = await getDashboardBriefing(userId);
  const repos = await getRepositories(userId);
  const repoId = await getPrimaryRepoId(userId);
  const score = repoId ? await getRepoScore(repoId) : null;
  const slop = repoId ? await getSlop(repoId) : null;

  if (!briefing) {
    return (
      <Card>
        <p className="text-zinc-400">Run an audit to generate the executive summary.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Executive dashboard</h1>
        <p className="mt-2 text-zinc-400">Founder-friendly summary — no jargon required.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ScoreGauge score={score?.overall ?? 0} label="Engineering health" />
        <Card>
          <p className="text-sm text-zinc-400">Critical risks</p>
          <p className="mt-2 text-3xl font-semibold">{briefing.criticalFindings.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">AI slop level</p>
          <p className="mt-2 text-3xl font-semibold">{slop?.overallPercent ?? 0}%</p>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium">What this means</h2>
        <p className="text-sm leading-7 text-zinc-300">{briefing.executiveSummary}</p>
        <p className="text-sm leading-7 text-zinc-400">
          Release readiness: {briefing.releaseReadiness}. Boswell estimates roughly{" "}
          <strong>{Math.round(briefing.debtHoursEstimate)} hours</strong> of focused engineering to clear the current queue.
        </p>
      </Card>

      {score ? (
        <Card>
          <h2 className="mb-4 text-lg font-medium">Health breakdown</h2>
          <DimensionBars dimensions={score.dimensions} />
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-medium">What changed this week</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-400">
          {briefing.whatChanged.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Boswell recommends next</h2>
        <ul className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          {briefing.suggestedActions.map((a) => (
            <li key={a.id}>{a.title}</li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-zinc-600">
        Watching {repos.length} repositories. Debt hour estimate is heuristic based on finding severity.
      </p>
    </div>
  );
}
