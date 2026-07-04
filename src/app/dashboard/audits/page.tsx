export const dynamic = "force-dynamic";

import Link from "next/link";
import { auth } from "@/lib/auth";
import { listAuditsForUser } from "@/lib/audits";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { Button, Card } from "@/components/ui";

export default async function AuditsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const audits = await listAuditsForUser(userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Audits</h1>
        <p className="mt-2 text-zinc-400">
          Every scan Boswell has run. Open one to read the report and copy its fix prompt.
        </p>
      </div>

      {audits.length === 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-zinc-400">No audits yet. Run one from a repository.</p>
          <Button href="/dashboard/repos">Go to repositories</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {audits.map((audit) => (
            <Card key={audit.id} className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-medium">{audit.repoFullName}</p>
                <p className="text-sm text-zinc-400">
                  {audit.deployVerdict ?? audit.summary ?? "Audit run"}
                  {audit.costUsd ? ` · ~$${Number(audit.costUsd).toFixed(2)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <AuditStatusBadge status={audit.status} />
                {audit.status === "completed" ? (
                  <Button href={`/dashboard/audits/${audit.id}#fix-prompt`}>Fix all issues</Button>
                ) : null}
                <Link href={`/dashboard/audits/${audit.id}`} className="text-sm text-zinc-400 underline">
                  Report
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
