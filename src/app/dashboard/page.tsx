export const dynamic = "force-dynamic";

import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { ScoreGauge } from "@/components/score-gauge";
import { RunAuditButton } from "@/components/run-audit-button";
import { SyncReposButton } from "@/components/sync-repos-button";
import {
  getDashboardBriefing,
  getLatestCompletedAuditId,
  getRepositories,
  getPrimaryRepoId,
  getPrimaryRepository,
  getRepoScore,
  getAuditReport,
} from "@/lib/data";
import { isDemoMode } from "@/lib/demo/mode";
import { requireUserId } from "@/lib/session";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const repos = await getRepositories(userId);
  const primaryRepoId = await getPrimaryRepoId(userId);
  const primaryRepo = await getPrimaryRepository(userId);
  const score = primaryRepoId ? await getRepoScore(primaryRepoId) : null;
  const latestCompleted = await getLatestCompletedAuditId(userId);
  const latestReport = latestCompleted ? await getAuditReport(userId, latestCompleted.auditId) : null;
  const briefing = await getDashboardBriefing(userId);

  const hasRepos = repos.length > 0;
  const hasAudit = latestReport?.status === "completed";

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-zinc-500">Boswell</p>
        <h1 className="text-3xl font-semibold">
          {hasAudit ? "Your latest audit is ready" : "Let’s audit your code"}
        </h1>
        <p className="max-w-2xl text-zinc-400">
          Boswell scans a GitHub repo, tells you what’s wrong in plain English, and gives you a
          prompt to paste into Cursor or ChatGPT so it fixes the issues.
        </p>
      </header>

      <StepFlow hasRepos={hasRepos} hasAudit={hasAudit} />

      {hasAudit && latestReport ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-medium">Latest audit</h2>
              <p className="text-sm text-zinc-500">{latestReport.repoFullName}</p>
            </div>
            <Button href={`/dashboard/audits/${latestReport.id}#fix-prompt`}>
              Open fix prompt →
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ScoreGauge score={latestReport.score.overall} label="Health score" />
            <Card>
              <p className="text-sm text-zinc-400">Issues found</p>
              <p className="mt-2 text-4xl font-semibold">{latestReport.findings.length}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {latestReport.priorityGroups.fixNow.length} need fixing now
              </p>
            </Card>
            <Card>
              <p className="text-sm text-zinc-400">Release readiness</p>
              <p className="mt-2 text-lg font-medium leading-6">
                {latestReport.briefing.releaseReadiness}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-zinc-400">Audit cost</p>
              <p className="mt-2 text-4xl font-semibold">
                {latestReport.costUsd ? `$${Number(latestReport.costUsd).toFixed(2)}` : "—"}
              </p>
            </Card>
          </div>

          {briefing?.topPriorityAction ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <p className="text-sm text-zinc-400">Top priority</p>
              <p className="mt-1 font-medium">{briefing.topPriorityAction}</p>
            </Card>
          ) : null}
        </section>
      ) : null}

      {primaryRepoId && !hasAudit ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Run your first audit</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {primaryRepo ? `Default repo: ${primaryRepo.fullName}` : "Pick a repo to audit"}
            </p>
          </div>
          <RunAuditButton repositoryId={primaryRepoId} />
        </Card>
      ) : null}

      {!hasRepos && !isDemoMode() ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Connect your repositories</h2>
            <p className="mt-1 text-sm text-zinc-500">Sync from GitHub to get started.</p>
          </div>
          <SyncReposButton />
        </Card>
      ) : null}

      {score && hasAudit ? (
        <p className="text-xs text-zinc-600">
          Want the full technical breakdown?{" "}
          <Link href={`/dashboard/audits/${latestReport?.id}`} className="underline">
            View complete report
          </Link>
        </p>
      ) : null}

      {isDemoMode() ? (
        <Card className="border-amber-500/20 bg-amber-500/5 text-sm text-amber-200">
          Demo mode is active — data is seeded locally. Connect Neon + GitHub for live repositories.
        </Card>
      ) : null}
    </div>
  );
}

function StepFlow({ hasRepos, hasAudit }: { hasRepos: boolean; hasAudit: boolean }) {
  const steps = [
    {
      n: 1,
      title: "Connect a repo",
      body: "Sync your GitHub repositories into Boswell.",
      done: hasRepos,
    },
    {
      n: 2,
      title: "Run an audit",
      body: "Boswell scans the code and finds issues.",
      done: hasAudit,
    },
    {
      n: 3,
      title: "Copy the fix prompt",
      body: "Paste it into Cursor or ChatGPT to fix everything.",
      done: false,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {steps.map((step) => (
        <Card
          key={step.n}
          className={step.done ? "border-emerald-500/30 bg-emerald-500/5" : undefined}
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                step.done ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {step.done ? "✓" : step.n}
            </span>
            <h3 className="font-medium">{step.title}</h3>
            {step.done ? <Badge tone="good">Done</Badge> : null}
          </div>
          <p className="mt-3 text-sm text-zinc-400">{step.body}</p>
        </Card>
      ))}
    </section>
  );
}
