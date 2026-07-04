import Link from "next/link";
import { Button, Card } from "@/components/ui";

export function FixAllIssuesCard({
  auditId,
  repoFullName,
  findingsCount,
}: {
  auditId: string;
  repoFullName: string;
  findingsCount: number;
}) {
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-widest text-emerald-300">Fix all issues</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Copy the LLM fix prompt for {repoFullName}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
            Boswell found {findingsCount} issues. Open the fix prompt, copy it, and paste it into
            Claude Code, ChatGPT, or Cursor in that repo to fix everything in priority order.
          </p>
        </div>
        <Button href={`/dashboard/audits/${auditId}#fix-prompt`}>Open fix prompt</Button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Direct link:{" "}
        <Link href={`/dashboard/audits/${auditId}#fix-prompt`} className="underline">
          /dashboard/audits/{auditId}#fix-prompt
        </Link>
      </p>
    </Card>
  );
}
