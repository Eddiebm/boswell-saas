export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRepositoryForUser } from "@/lib/repositories";
import { Card } from "@/components/ui";
import { RunAuditButton } from "@/components/run-audit-button";

type Params = { params: Promise<{ id: string }> };

export default async function RepoDetailPage({ params }: Params) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { id } = await params;
  const repo = await getRepositoryForUser(userId, id);
  if (!repo) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{repo.fullName}</h1>
        <p className="mt-2 text-zinc-400">{repo.description ?? "No description"}</p>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-2 text-sm text-zinc-300">
          <p>Owner: {repo.owner}</p>
          <p>Default branch: {repo.defaultBranch}</p>
          <p>Visibility: {repo.isPrivate ? "Private" : "Public"}</p>
        </div>
        <RunAuditButton repositoryId={repo.id} />
      </Card>
    </div>
  );
}
