export const dynamic = "force-dynamic";

import Link from "next/link";
import { Badge, Card, AutoFixBadge } from "@/components/ui";
import { getFixQueue, DEMO_REPO_ID } from "@/lib/data";

export default async function FixQueuePage() {
  const items = await getFixQueue(DEMO_REPO_ID);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Fix queue</h1>
        <p className="mt-2 text-zinc-400">
          Ignore most findings. Fix these first. Boswell never pushes to main — only opens PRs for green-tier fixes.
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => (
          <Card key={item.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">#{index + 1}</span>
              <Badge tone={item.severity === "HIGH" || item.severity === "CRITICAL" ? "bad" : "warn"}>
                {item.severity}
              </Badge>
              <Badge tone="neutral">Priority {item.priorityScore}</Badge>
              {item.canAutoPr ? <Badge tone="good">PR eligible</Badge> : null}
            </div>
            <h2 className="text-lg font-medium">{item.title}</h2>
            <p className="text-sm text-zinc-400">{item.whyItMatters}</p>
            <p className="text-sm text-zinc-300">{item.suggestedFix}</p>
            <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
              <span>Effort: {item.effort}</span>
              <span>Impact: {item.impact}</span>
              <span>Files: {(item.files ?? []).join(", ") || "—"}</span>
            </div>
            {item.canAutoPr ? (
              <form action="/api/pr/create" method="post">
                <input type="hidden" name="itemId" value={item.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
                >
                  Create safe-fix PR
                </button>
              </form>
            ) : (
              <p className="text-xs text-amber-300">Needs human review before Boswell can open a PR.</p>
            )}
          </Card>
        ))}
      </div>

      <Card className="text-sm text-zinc-400">
        Safe auto-fixes only: dead imports, docs, simple config, obvious duplicate cleanup.{" "}
        <Link href="/dashboard/repos/demo-repo-audiolens" className="underline">
          View repository
        </Link>
      </Card>
    </div>
  );
}
