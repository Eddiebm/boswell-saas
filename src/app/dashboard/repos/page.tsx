export const dynamic = "force-dynamic";

import Link from "next/link";
import { listRepositoriesForUser } from "@/lib/repositories";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui";
import { SyncReposButton } from "@/components/sync-repos-button";
import { RunAuditButton } from "@/components/run-audit-button";

export default async function ReposPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const repos = await listRepositoriesForUser(userId);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Repositories</h1>
          <p className="mt-2 text-zinc-400">Connected GitHub repositories available for audit.</p>
        </div>
        <SyncReposButton />
      </div>

      <div className="grid gap-4">
        {repos.map((repo) => (
          <Card key={repo.id} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <Link href={`/dashboard/repos/${repo.id}`} className="text-lg font-medium hover:underline">
                {repo.fullName}
              </Link>
              <p className="mt-1 text-sm text-zinc-400">{repo.description ?? "No description"}</p>
              <p className="mt-2 text-xs text-zinc-500">
                {repo.isPrivate ? "Private" : "Public"}
                {repo.lastAuditAt ? ` · Last audit ${repo.lastAuditAt.toISOString()}` : ""}
              </p>
            </div>
            <RunAuditButton repositoryId={repo.id} />
          </Card>
        ))}
        {repos.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-400">No repositories synced yet. Click sync to import from GitHub.</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
