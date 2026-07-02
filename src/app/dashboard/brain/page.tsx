export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { BrainChat } from "@/components/brain-chat";
import { getPrimaryRepoId, getPrimaryRepository } from "@/lib/data";
import { requireUserId } from "@/lib/session";

export default async function BrainPage() {
  const userId = await requireUserId();
  const primaryRepoId = await getPrimaryRepoId(userId);
  const primaryRepo = await getPrimaryRepository(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Engineering brain</h1>
        <p className="mt-2 text-zinc-400">
          Ask questions grounded in audits, files, scores, and memory. Boswell will not invent facts.
        </p>
        {primaryRepo ? (
          <p className="mt-2 text-sm text-zinc-500">
            Answering for <span className="text-zinc-300">{primaryRepo.fullName}</span> — change via
            the repo selector in the header.
          </p>
        ) : null}
      </div>
      <Card>
        <BrainChat repositoryId={primaryRepoId} />
      </Card>
    </div>
  );
}
