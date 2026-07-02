export const dynamic = "force-dynamic";

import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { ScoreGauge } from "@/components/score-gauge";
import { RunAuditButton } from "@/components/run-audit-button";
import { SyncReposButton } from "@/components/sync-repos-button";
import { getDashboardBriefing, getRepositories, getPrimaryRepoId, getPrimaryRepository, getRepoScore } from "@/lib/data";
import { isDemoMode } from "@/lib/demo/mode";
import { requireUserId } from "@/lib/session";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const briefing = await getDashboardBriefing(userId);
  const repos = await getRepositories(userId);
  const primaryRepoId = await getPrimaryRepoId(userId);
  const primaryRepo = await getPrimaryRepository(userId);
  const score = primaryRepoId ? await getRepoScore(primaryRepoId) : null;

  if (!briefing) {
    return (
      <div className="space-y-6">
        <Card>
          <p className="text-zinc-400">
            {repos.length
              ? "Run your first audit to get a daily briefing."
              : "Sync a GitHub repository, then run your first audit."}
          </p>
        </Card>
        {!isDemoMode() && !repos.length ? (
          <div className="flex flex-wrap gap-3">
            <SyncReposButton />
            <Button href="/dashboard/onboarding" variant="secondary">
              Setup guide
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const latestAuditHref = primaryRepoId
    ? `/dashboard/audits`
    : "/dashboard/audits";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-widest text-zinc-500">Daily CTO Briefing</p>
          <h1 className="mt-2 text-3xl font-semibold">{briefing.greeting}</h1>
          {primaryRepo ? (
            <p className="mt-2 text-sm text-zinc-500">
              Repository: <span className="text-zinc-300">{primaryRepo.fullName}</span>
            </p>
          ) : null}
          <p className="mt-3 max-w-2xl text-zinc-400">{briefing.executiveSummary}</p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-zinc-500">{briefing.plainEnglishSummary}</p>
        </div>
        <div className="flex gap-2">
          {primaryRepoId ? (
            <>
              <RunAuditButton repositoryId={primaryRepoId} />
              <Button href={latestAuditHref} variant="secondary">
                View audits
              </Button>
            </>
          ) : !isDemoMode() ? (
            <SyncReposButton />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <ScoreGauge score={score?.overall ?? 0} label="Health score" />
        <Card>
          <p className="text-sm text-zinc-400">Top priority today</p>
          <p className="mt-2 text-sm font-medium leading-6">
            {briefing.topPriorityAction ?? "No urgent blockers"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Tech debt estimate</p>
          <p className="mt-2 text-3xl font-semibold">~{Math.round(briefing.debtHoursEstimate)}h</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Health delta</p>
          <p className="mt-2 text-lg font-medium">
            {briefing.healthDelta == null
              ? "—"
              : briefing.healthDelta >= 0
                ? `+${briefing.healthDelta}`
                : briefing.healthDelta}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BriefingList title="What changed" items={briefing.whatChanged} />
        <BriefingList title="New risks" items={briefing.newRisks} tone="bad" />
        <BriefingList title="Fixed risks" items={briefing.fixedRisks} tone="good" />
        <BriefingList title="Ignored risks" items={briefing.ignoredRisks} tone="warn" />
      </div>

      <section className="grid gap-4 lg:grid-cols-4">
        <ClassificationCard title="Good" items={briefing.classifications.good} tone="good" />
        <ClassificationCard title="Bad" items={briefing.classifications.bad} tone="warn" />
        <ClassificationCard title="Dangerous" items={briefing.classifications.dangerous} tone="bad" />
        <ClassificationCard title="Evil" items={briefing.classifications.evil} tone="evil" />
      </section>

      {briefing.safePrsReady.length ? (
        <Card>
          <h2 className="font-medium">Safe PRs ready for review</h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            {briefing.safePrsReady.map((pr) => (
              <li key={pr} className="flex gap-2">
                <Badge tone="good">GREEN</Badge>
                <span>{pr}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Ignore most findings. Fix these first.</h2>
        <div className="space-y-3">
          {briefing.suggestedActions.map((action) => (
            <Card key={action.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={action.severity === "HIGH" || action.severity === "CRITICAL" ? "bad" : "warn"}>
                    {action.severity}
                  </Badge>
                  <p className="font-medium">{action.title}</p>
                </div>
                <p className="mt-1 text-sm text-zinc-500">Est. effort: {action.effort}</p>
              </div>
              <Link href={action.href} className="text-sm underline">
                Open
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <p className="text-sm text-zinc-400">Release readiness</p>
        <p className="mt-2 font-medium">{briefing.releaseReadiness}</p>
      </Card>

      {isDemoMode() ? (
        <Card className="border-amber-500/20 bg-amber-500/5 text-sm text-amber-200">
          Demo mode is active — data is seeded locally. Connect Neon + GitHub for live repositories.
        </Card>
      ) : null}
    </div>
  );
}

function BriefingList({
  title,
  items,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <Card>
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-zinc-400">
        {items.length ? (
          items.map((item) => (
            <li key={item} className="flex gap-2">
              <Badge tone={tone}>•</Badge>
              <span>{item}</span>
            </li>
          ))
        ) : (
          <li>Nothing notable.</li>
        )}
      </ul>
    </Card>
  );
}

function ClassificationCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn" | "bad" | "evil";
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-zinc-400">
        {items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>None</li>}
      </ul>
    </Card>
  );
}
