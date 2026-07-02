export const dynamic = "force-dynamic";

import Link from "next/link";
import { auth } from "@/lib/auth";
import { listAuditsForUser } from "@/lib/audits";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { Card } from "@/components/ui";

export default async function AuditsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const audits = await listAuditsForUser(userId);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Audits</h1>
      <div className="space-y-3">
        {audits.map((audit) => (
          <Card key={audit.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{audit.repoFullName}</p>
              <p className="text-sm text-zinc-400">
                {audit.deployVerdict ?? audit.summary ?? "Audit run"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <AuditStatusBadge status={audit.status} />
              <Link href={`/dashboard/audits/${audit.id}`} className="text-sm underline">
                View
              </Link>
            </div>
          </Card>
        ))}
        {audits.length === 0 ? <p className="text-sm text-zinc-500">No audits yet.</p> : null}
      </div>
    </div>
  );
}
