export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { ScoreGauge, DimensionBars } from "@/components/score-gauge";
import { getDashboardBriefing, getRepositories, getRepoScore, getSlop } from "@/lib/data";
import { DEMO_REPO_ID } from "@/lib/data";

export default async function ExecutivePage() {
  const briefing = await getDashboardBriefing("demo-user");
  const repos = await getRepositories("demo-user");
  const score = await getRepoScore(DEMO_REPO_ID);
  const slop = await getSlop(DEMO_REPO_ID);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Executive dashboard</h1>
        <p className="mt-2 text-zinc-400">
          Founder-friendly summary — no jargon required.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ScoreGauge score={score?.overall ?? 0} label="Engineering health" />
        <Card>
          <p className="text-sm text-zinc-400">Critical risks</p>
          <p className="mt-2 text-3xl font-semibold">{briefing?.criticalFindings.length ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">AI slop level</p>
          <p className="mt-2 text-3xl font-semibold">{slop.overallPercent}%</p>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium">What this means</h2>
        <p className="text-sm leading-7 text-zinc-300">{briefing?.executiveSummary}</p>
        <p className="text-sm leading-7 text-zinc-400">
          Release readiness: {briefing?.releaseReadiness}. Boswell estimates roughly{" "}
          <strong>12–18 hours</strong> of focused engineering to clear the current high-priority queue.
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
          {(briefing?.whatChanged ?? []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Boswell recommends next</h2>
        <ul className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          {(briefing?.suggestedActions ?? []).map((a) => (
            <li key={a.id}>{a.title}</li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-zinc-600">
        Watching {repos.length} repositories. Debt hour estimate is heuristic based on finding severity and effort tags.
      </p>
    </div>
  );
}
