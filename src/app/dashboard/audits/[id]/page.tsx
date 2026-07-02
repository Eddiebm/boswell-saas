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

type Params = { params: Promise<{ id: string }> };

export default async function AuditDetailPage({ params }: Params) {
  const { id } = await params;
  const report = await getAuditReport(id);
  if (!report) notFound();

  const structured = report.structured;

  return (
    <div className="space-y-8">
      <AuditPoller status="completed" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Audit report</h1>
        <AuditStatusBadge status="completed" />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <ScoreGauge score={report.score.overall} label="Health at audit time" />
        <Card>
          <p className="text-sm text-zinc-400">AI Slop</p>
          <p className="mt-2 text-3xl font-semibold">{report.slop.overallPercent}%</p>
          <p className="mt-1 text-xs text-zinc-500">Indicators only — not proof</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Tech debt</p>
          <p className="mt-2 text-3xl font-semibold">~{structured?.debtHoursEstimate ?? 0}h</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Release readiness</p>
          <p className="mt-2 font-medium">{report.briefing.releaseReadiness}</p>
        </Card>
      </div>

      {structured ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <ReportSection title="Good findings" items={structured.good} tone="good" />
          <ReportSection title="Bad findings" items={structured.bad} tone="warn" />
          <ReportSection title="Dangerous findings" items={structured.dangerous} tone="bad" />
          <ReportSection title="Evil findings" items={structured.evil} tone="evil" />
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Findings with coaching</h2>
        {report.findings.map((f) => (
          <div key={f.id} id={f.id}>
            <div className="mb-2 flex flex-wrap gap-2">
              <ClassificationBadge classification={f.classification} />
              {"autoFixLevel" in f ? <AutoFixBadge level={String(f.autoFixLevel)} /> : null}
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
