export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getAuditReport } from "@/lib/data";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { AuditPoller } from "@/components/audit-poller";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { MarkdownViewer } from "@/components/markdown-viewer";
import { CoachingCard } from "@/components/coaching-card";
import { Card } from "@/components/ui";
import { ScoreGauge } from "@/components/score-gauge";

type Params = { params: Promise<{ id: string }> };

export default async function AuditDetailPage({ params }: Params) {
  const { id } = await params;
  const report = await getAuditReport(id);
  if (!report) notFound();

  return (
    <div className="space-y-8">
      <AuditPoller status="completed" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Audit report</h1>
        <AuditStatusBadge status="completed" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ScoreGauge score={report.score.overall} label="Health at audit time" />
        <Card>
          <p className="text-sm text-zinc-400">AI Slop</p>
          <p className="mt-2 text-3xl font-semibold">{report.slop.overallPercent}%</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Release readiness</p>
          <p className="mt-2 font-medium">{report.briefing.releaseReadiness}</p>
        </Card>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Findings with coaching</h2>
        {report.findings.map((f) => (
          <div key={f.id} id={f.id}>
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
