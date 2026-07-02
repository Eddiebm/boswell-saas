export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAuditForUser } from "@/lib/audits";
import { AuditPoller } from "@/components/audit-poller";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { MarkdownViewer } from "@/components/markdown-viewer";
import { Badge, Card } from "@/components/ui";

type Params = { params: Promise<{ id: string }> };

export default async function AuditDetailPage({ params }: Params) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { id } = await params;
  const audit = await getAuditForUser(userId, id);
  if (!audit) notFound();

  const auditDoc =
    audit.docs.find((d) => d.docType === "audit")?.content ??
    audit.docs.find((d) => d.docType === "audit-simple")?.content ??
    "";
  const handoffDoc = audit.docs.find((d) => d.docType === "handoff")?.content ?? "";

  return (
    <div className="space-y-8">
      <AuditPoller status={audit.run.status} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{audit.repo?.fullName}</h1>
        <AuditStatusBadge status={audit.run.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-zinc-400">Deploy verdict</p>
          <p className="mt-2 font-medium">{audit.run.deployVerdict ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Top risk</p>
          <p className="mt-2 font-medium">{audit.run.topRisk ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-400">Cost</p>
          <p className="mt-2 font-medium">
            {audit.run.costUsd ? `$${audit.run.costUsd}` : "—"}
          </p>
        </Card>
      </div>

      {audit.run.error ? (
        <Card>
          <p className="text-red-400">{audit.run.error}</p>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Findings</h2>
        <div className="space-y-3">
          {audit.findings.map((finding) => (
            <Card key={finding.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    finding.severity === "CRITICAL" || finding.severity === "HIGH"
                      ? "bad"
                      : "warn"
                  }
                >
                  {finding.severity}
                </Badge>
                <span className="text-sm text-zinc-400">{finding.category}</span>
              </div>
              <p className="mt-3 font-medium">{finding.title}</p>
              <p className="mt-2 text-sm text-zinc-400">{finding.description}</p>
              {finding.filePath ? (
                <p className="mt-2 text-xs text-zinc-500">
                  {finding.filePath}
                  {finding.lineNumber ? `:${finding.lineNumber}` : ""}
                </p>
              ) : null}
            </Card>
          ))}
          {audit.findings.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {audit.run.status === "completed"
                ? "No findings recorded."
                : "Findings will appear when the audit completes."}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Audit report</h2>
        <Card>
          <MarkdownViewer content={auditDoc} />
        </Card>
      </section>

      {handoffDoc ? (
        <section className="space-y-4">
          <h2 className="text-xl font-medium">Handoff</h2>
          <Card>
            <MarkdownViewer content={handoffDoc} />
          </Card>
        </section>
      ) : null}
    </div>
  );
}
