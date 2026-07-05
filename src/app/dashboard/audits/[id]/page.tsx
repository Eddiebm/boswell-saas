export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getAuditReport } from "@/lib/data";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { auditModeLabel } from "@/lib/audit-modes";
import { AuditPoller } from "@/components/audit-poller";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { AuditWaitIndicator } from "@/components/audit-wait-indicator";
import { OwaspTop10Card } from "@/components/owasp-top10-card";
import { CopyFixPromptButton } from "@/components/copy-fix-prompt-button";
import { MarkdownViewer } from "@/components/markdown-viewer";
import { CoachingCard } from "@/components/coaching-card";
import { AutoFixBadge, Badge, Card, ClassificationBadge } from "@/components/ui";
import { ScoreGauge } from "@/components/score-gauge";
import { requireUserId } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export default async function AuditDetailPage({ params }: Params) {
  const userId = await requireUserId();
  const { id } = await params;
  const report = await getAuditReport(userId, id);
  if (!report) notFound();

  const isPending = report.status === "queued" || report.status === "running";

  return (
    <div className="space-y-8">
      <AuditPoller status={report.status} />
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Audit report</h1>
          <p className="mt-1 text-sm text-zinc-400">{report.repoFullName}</p>
        </div>
        <AuditStatusBadge status={report.status} />
        <Badge tone="neutral">{auditModeLabel(report.auditMode)}</Badge>
      </div>

      {report.status === "failed" ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <p className="font-medium text-red-300">Audit failed</p>
          <p className="mt-2 text-sm text-zinc-400">{report.error ?? "Unknown error"}</p>
          <p className="mt-2 text-xs text-zinc-500">
            If the worker timed out, start a new audit. Check{" "}
            <a
              href="https://github.com/Eddiebm/boswell-saas/actions/workflows/audit-worker.yml"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Actions
            </a>{" "}
            if this keeps happening.
          </p>
        </Card>
      ) : null}

      {isPending ? (
        <Card>
          <p className="text-zinc-300">Audit is {report.status}…</p>
          <AuditWaitIndicator
            status={report.status}
            createdAt={report.createdAt}
            startedAt={report.startedAt}
          />
          <p className="mt-2 text-sm text-zinc-500">This page refreshes automatically every 5 seconds.</p>
        </Card>
      ) : null}

      {report.status === "completed" ? (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <ScoreGauge score={report.score.overall} label="Health at audit time" />
            <Card>
              <p className="text-sm text-zinc-400">AI Slop</p>
              <p className="mt-2 text-3xl font-semibold">{report.slop.overallPercent}%</p>
              <p className="mt-1 text-xs text-zinc-500">Indicators only — not proof</p>
            </Card>
            <Card>
              <p className="text-sm text-zinc-400">Tech debt</p>
              <p className="mt-2 text-3xl font-semibold">~{report.structured?.debtHoursEstimate ?? 0}h</p>
            </Card>
            <Card>
              <p className="text-sm text-zinc-400">Release readiness</p>
              <p className="mt-2 font-medium">{report.briefing.releaseReadiness}</p>
            </Card>
            <Card>
              <p className="text-sm text-zinc-400">Audit cost</p>
              <p className="mt-2 text-3xl font-semibold">
                {report.costUsd ? `$${Number(report.costUsd).toFixed(2)}` : "—"}
              </p>
            </Card>
          </div>

          <section id="fix-prompt" className="space-y-4 scroll-mt-24">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Fix all issues — LLM prompt</h2>
                <p className="mt-1 text-sm text-zinc-300">
                  Copy this entire prompt into Claude Code, ChatGPT, or Cursor in{" "}
                  <strong>{report.repoFullName}</strong> to fix all {report.findings.length} issues.
                </p>
              </div>
              <CopyFixPromptButton prompt={report.fixPrompt} />
            </div>
            <Card className="border-emerald-500/20">
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-sm text-zinc-200">
                {report.fixPrompt}
              </pre>
            </Card>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-medium">Plain-English summary</h2>
            <Card>
              <MarkdownViewer content={report.consumerSummary} />
            </Card>
          </section>

          <OwaspTop10Card summary={report.owaspSummary} />

          <section className="grid gap-4 lg:grid-cols-3">
            <PriorityCard title="Fix now" items={report.priorityGroups.fixNow} tone="bad" />
            <PriorityCard title="Fix next" items={report.priorityGroups.fixNext} tone="warn" />
            <PriorityCard title="Can wait" items={report.priorityGroups.later} tone="neutral" />
          </section>

          {report.structured ? (
            <section className="grid gap-4 lg:grid-cols-2">
              <ReportSection title="Good findings" items={report.structured.good} tone="good" />
              <ReportSection title="Bad findings" items={report.structured.bad} tone="warn" />
              <ReportSection title="Dangerous findings" items={report.structured.dangerous} tone="bad" />
              <ReportSection title="Evil findings" items={report.structured.evil} tone="evil" />
            </section>
          ) : null}

          <section className="space-y-4">
            <h2 className="text-xl font-medium">Findings with coaching</h2>
            {report.findings.map((f) => (
              <div key={f.id} id={f.id}>
                <div className="mb-2 flex flex-wrap gap-2">
                  <Badge tone="neutral">{f.priorityLabel}</Badge>
                  <ClassificationBadge classification={f.classification} />
                  <AutoFixBadge level={f.autoFixLevel} />
                  <Badge tone="neutral">{f.severity}</Badge>
                  {f.owaspCode ? <Badge tone="warn">{f.owaspCode}</Badge> : null}
                </div>
                <CoachingCard title={f.title} coaching={f.coaching as CoachingSections} showEli5 />
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-medium">Technical audit markdown</h2>
            <Card>
              <MarkdownViewer content={report.markdown} />
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}

function PriorityCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: Array<{ id: string; title: string; filePath?: string }>;
  tone: "good" | "warn" | "bad" | "evil" | "neutral";
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-zinc-400">
        {items.length ? (
          items.map((item) => (
            <li key={item.id}>
              <span className="text-zinc-200">{item.title}</span>
              {item.filePath ? <span className="text-zinc-500"> — {item.filePath}</span> : null}
            </li>
          ))
        ) : (
          <li>None</li>
        )}
      </ul>
    </Card>
  );
}

function ReportSection({
  title,
  items,
  tone,
}: {
  title: string;
  items: Array<{ id: string; title: string; description: string; filePath?: string }>;
  tone: "good" | "warn" | "bad" | "evil";
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-zinc-400">
        {items.length ? (
          items.map((item) => (
            <li key={item.id}>
              <span className="text-zinc-200">{item.title}</span>
              {item.filePath ? <span className="text-zinc-500"> — {item.filePath}</span> : null}
            </li>
          ))
        ) : (
          <li>None</li>
        )}
      </ul>
    </Card>
  );
}
