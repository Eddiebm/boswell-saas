export const dynamic = "force-dynamic";

import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { CopyFixPromptButton } from "@/components/copy-fix-prompt-button";
import { GuardToggle } from "@/components/guard-toggle";
import { LiveUrlForm } from "@/components/live-url-form";
import { getShipReady } from "@/lib/ship-ready/data";
import type { ItemStatus, ShipReadyItem } from "@/lib/ship-ready/checklist";
import { requireUserId } from "@/lib/session";

type Props = { searchParams: Promise<{ audit?: string }> };

const STATUS: Record<ItemStatus, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  fail: { label: "Blocker", tone: "bad" },
  review: { label: "Check this", tone: "warn" },
  unverified: { label: "Confirm", tone: "neutral" },
  pass: { label: "Pass", tone: "good" },
  "n/a": { label: "Not needed", tone: "neutral" },
};

const SECTIONS: Array<{ status: ItemStatus; title: string; blurb: string }> = [
  { status: "fail", title: "Blockers", blurb: "Proven problems. Fix these before you launch." },
  { status: "review", title: "Check before launch", blurb: "Boswell matched these by pattern — confirm each one is real, then fix or dismiss it." },
  { status: "unverified", title: "Confirm yourself", blurb: "Things Boswell can't see from your code. Follow the steps for each one before you launch." },
  { status: "pass", title: "Passed", blurb: "Checked and clear on this audit." },
  { status: "n/a", title: "Not needed for this app", blurb: "" },
];

function ItemCard({ item, auditId, dependencyFixId }: { item: ShipReadyItem; auditId: string; dependencyFixId: string | null }) {
  const status = STATUS[item.status];
  const actionable = item.status === "fail" || item.status === "review";
  return (
    <Card className={item.status === "fail" ? "border-red-500/40" : item.status === "review" ? "border-amber-500/30" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-zinc-500">{item.area}</p>
          <h3 className="mt-1 text-lg font-medium">{item.title}</h3>
          <p className="mt-1 text-sm text-zinc-400">{item.why}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {actionable && item.findings.length ? (
        <ul className="mt-4 space-y-2 text-sm">
          {item.findings.slice(0, 6).map((f) => (
            <li key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <p className="text-zinc-200">
                <span className="text-zinc-500">[{f.severity}]</span> {f.title}
              </p>
              {f.filePath ? (
                <p className="mt-1 break-all font-mono text-xs text-zinc-500">
                  {f.filePath}
                  {f.lineStart ? `:${f.lineStart}` : ""}
                </p>
              ) : null}
              {f.recommendation ? <p className="mt-2 text-zinc-400">{f.recommendation}</p> : null}
            </li>
          ))}
          {item.findings.length > 6 ? <li className="text-xs text-zinc-500">…and {item.findings.length - 6} more in the audit report.</li> : null}
        </ul>
      ) : null}

      {item.steps.length && (item.status === "unverified" || item.fix === "steps") ? (
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
          {item.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      {actionable ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {item.fix === "auto" && dependencyFixId ? (
            <Link href={`/dashboard/audits/${auditId}#dependency-fix`} className="text-sm font-medium text-emerald-300 underline">
              Boswell has a fix PR ready →
            </Link>
          ) : null}
          {item.prompt ? <CopyFixPromptButton prompt={item.prompt} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

export default async function ShipReadyPage({ searchParams }: Props) {
  const userId = await requireUserId();
  const { audit } = await searchParams;
  const view = await getShipReady(userId, audit);

  if (!view) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">Ship Ready</h1>
        <Card>
          <p className="text-zinc-300">Run an audit on your app and Boswell will tell you exactly what stands between it and launch.</p>
          <Link href="/dashboard/repos" className="mt-4 inline-block text-sm underline">
            Choose a repository →
          </Link>
        </Card>
      </div>
    );
  }

  const { verdict } = view;
  const banner =
    verdict.state === "ready"
      ? "border-emerald-500/40 bg-emerald-500/10"
      : verdict.state === "almost"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-red-500/40 bg-red-500/10";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Ship Ready</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {view.repoFullName}
          {view.checkedAt ? ` · checked ${new Date(view.checkedAt).toLocaleString()}` : ""} ·{" "}
          <Link href={`/dashboard/audits/${view.auditId}`} className="underline">
            full audit
          </Link>
        </p>
      </div>

      <section className={`rounded-xl border p-6 ${banner}`}>
        <p className="text-2xl font-semibold text-white">{verdict.headline}</p>
        <p className="mt-2 text-sm text-zinc-300">
          {verdict.blockers} {verdict.blockers === 1 ? "blocker" : "blockers"} · {verdict.toReview} to check · {verdict.toConfirm} to confirm yourself ·{" "}
          {verdict.passed} passed
        </p>
        {view.needsReaudit ? (
          <p className="mt-3 text-sm text-amber-200">
            This audit ran before Ship Ready existed, so most checks couldn&apos;t be judged. Run a new audit for a full verdict.
          </p>
        ) : null}
        {verdict.fixAllPrompt ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-zinc-300">Fix everything at once: paste this into Claude Code, Cursor or your AI tool, then re-run the audit.</p>
            <CopyFixPromptButton prompt={verdict.fixAllPrompt} />
          </div>
        ) : null}
      </section>

      {view.guard ? (
        <Card>
          <h2 className="text-lg font-medium">Live site</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Where your app is deployed. Boswell then checks it on every audit: what the public can download (secrets in your JavaScript,
            .env and .git files, source maps), which API routes answer without a login, and whether every page loads in a real browser on
            desktop and phone. Read-only — it never submits forms or changes data.
          </p>
          <div className="mt-3">
            <LiveUrlForm repositoryId={view.guard.repositoryId} liveUrl={view.liveUrl} />
          </div>
        </Card>
      ) : null}

      {view.guard ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-lg font-medium">Push guard {view.guard.enabled ? <Badge tone="good">On</Badge> : <Badge tone="neutral">Off</Badge>}</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Boswell checks every push to your default branch and every pull request, marks the commit on GitHub, and comments on the PR
                when a change adds a launch blocker. Pushes to the default branch keep this page up to date — fix something, push, and the
                verdict updates. Checks only: no AI cost, and nothing in your repo is run.
              </p>
              {view.guard.lastRun ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Last check{view.guard.lastRun.commitSha ? ` on ${view.guard.lastRun.commitSha.slice(0, 7)}` : ""}
                  {view.guard.lastRun.at ? ` · ${new Date(view.guard.lastRun.at).toLocaleString()}` : ""}
                  {view.guard.lastRun.description ? ` · ${view.guard.lastRun.description}` : ""}
                </p>
              ) : null}
            </div>
            <GuardToggle repositoryId={view.guard.repositoryId} enabled={view.guard.enabled} />
          </div>
        </Card>
      ) : null}

      {SECTIONS.map((section) => {
        const items = verdict.items.filter((i) => i.status === section.status);
        if (!items.length) return null;
        return (
          <section key={section.status} className="space-y-3">
            <div>
              <h2 className="text-xl font-medium">
                {section.title} <span className="text-zinc-500">({items.length})</span>
              </h2>
              {section.blurb ? <p className="text-sm text-zinc-500">{section.blurb}</p> : null}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} auditId={view.auditId} dependencyFixId={view.dependencyFixId} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
