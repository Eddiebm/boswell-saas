export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getAuditReport } from "@/lib/data";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { AuditPoller } from "@/components/audit-poller";
import { AuditStatusBadge } from "@/components/audit-status-badge";
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
        <h1 className="text-3xl font-semibold">Audit report</h1>
        <AuditStatusBadge status={report.status} />
      </div>

      {report.status === "failed" ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <p className="font-medium text-red-300">Audit failed</p>
          <p className="mt-2 text-sm text-zinc-400">{report.error ?? "Unknown error"}</p>
          <p className="mt-2 text-xs text-zinc-500">
            The cloud worker retries automatically. Start a new audit if this keeps failing.
          </p>
        </Card>
      ) : null}

      {isPending ? (
        <Card>
          <p className="text-zinc-300">Audit is {report.status}…</p>
          <p className="mt-2 text-sm text-zinc-500">
            Run <code className="text-zinc-400">npm run worker</code> in a separate terminal if this takes more than a minute.
          </p>
        </Card>
      ) : null}

      {report.status === "completed" ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
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
          </div>

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
                  <ClassificationBadge classification={f.classification} />
                  <AutoFixBadge level={f.autoFixLevel} />
                  <Badge tone="neutral">{f.severity}</Badge>
                </div>
                <CoachingCard title={f.title} coaching={f.coaching as CoachingSections} showEli5 />
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-medium">Full audit markdown</h2>
            <Card>
              <MarkdownViewer content={report.markdown} />
            </Card>
          </section>
        </>
      ) : null}
    </div>
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
