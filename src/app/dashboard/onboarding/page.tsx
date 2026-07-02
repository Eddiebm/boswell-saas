export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { SyncReposButton } from "@/components/sync-repos-button";
import { requireUserId } from "@/lib/session";
import { isDemoMode } from "@/lib/demo/mode";

export default async function OnboardingPage() {
  await requireUserId();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Welcome to Boswell</h1>
        <p className="mt-2 text-zinc-400">
          Your AI Engineering CTO is ready. Connect a repository to get your first daily briefing.
        </p>
      </div>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium">Step 1 — Connect GitHub</h2>
        <p className="text-sm text-zinc-400">
          Boswell watches your code, remembers what changed, and tells you what to fix next. Sync up to
          your plan limit of repositories.
        </p>
        {!isDemoMode() ? <SyncReposButton /> : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium">Step 2 — Run an audit</h2>
        <p className="text-sm text-zinc-400">
          After syncing, open <strong>Repositories</strong> and click <strong>Run audit</strong>. Audits
          run on a background worker (not in the browser).
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium">Step 3 — Read your Daily CTO Briefing</h2>
        <p className="text-sm text-zinc-400">
          Your homepage shows what changed, what is dangerous, and what to fix first.
        </p>
      </Card>
    </div>
  );
}
