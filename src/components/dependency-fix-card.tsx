"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";

export type DependencyFixView = {
  id: string;
  lockfilePath: string;
  status: string;
  prUrl: string | null;
  changeCount: number;
  pinBumps: Array<{ name: string; from: string; to: string }>;
  beforeCounts: Record<string, number> | null;
  afterCounts: Record<string, number> | null;
};

const SEVERITIES = ["critical", "high", "moderate", "low"] as const;

function Counts({ label, counts }: { label: string; counts: Record<string, number> | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{counts?.total ?? "—"}</p>
      <p className="mt-1 text-xs text-zinc-400">
        {counts ? SEVERITIES.map((s) => `${counts[s] ?? 0} ${s}`).join(" · ") : "unknown"}
      </p>
    </div>
  );
}

export function DependencyFixCard({ fix }: { fix: DependencyFixView }) {
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(fix.prUrl);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPr() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/dependency-fix/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixId: fix.id }),
      });
      const data = (await res.json()) as { message?: string; prUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to open PR");
      setMessage(data.message ?? "PR opened");
      if (data.prUrl) setPrUrl(data.prUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-emerald-500/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">Dependency fix ready</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Non-breaking fixes for <code>{fix.lockfilePath}</code>, computed without installing or running your code.
            Your CI verifies the PR.
          </p>
        </div>
        <Badge tone={fix.status === "stale" ? "warn" : "good"}>
          {fix.status === "pr_opened" || prUrl ? "PR opened" : fix.status === "stale" ? "Outdated" : `${fix.changeCount} package changes`}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Counts label="Advisories now" counts={fix.beforeCounts} />
        <Counts label="After this PR" counts={fix.afterCounts} />
      </div>

      {fix.pinBumps.length ? (
        <p className="mt-3 text-sm text-zinc-400">
          Also raises {fix.pinBumps.map((b) => `${b.name} ${b.from} → ${b.to}`).join(", ")} in package.json (same major version).
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {prUrl ? (
          <a href={prUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            View pull request
          </a>
        ) : fix.status === "stale" ? (
          <p className="text-sm text-zinc-500">The lockfile changed after this audit. Run a new audit to get a fresh fix.</p>
        ) : (
          <Button onClick={openPr} disabled={loading}>
            {loading ? "Opening PR…" : "Open dependency fix PR"}
          </Button>
        )}
        {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    </Card>
  );
}
