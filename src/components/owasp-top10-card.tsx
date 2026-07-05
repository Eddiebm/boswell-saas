import { Badge, Card } from "@/components/ui";
import type { OwaspTop10Summary } from "@/lib/reports/owasp-top10";

export function OwaspTop10Card({ summary }: { summary: OwaspTop10Summary }) {
  const hasIssues = summary.categories.length > 0 || summary.unmappedCount > 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">OWASP Top 10:2021</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Heuristic mapping from audit findings — not a formal compliance scan.
          </p>
        </div>
        <Badge tone={summary.categories.some((c) => c.findings.some((f) => f.severity === "CRITICAL" || f.severity === "HIGH")) ? "bad" : "neutral"}>
          {summary.totalMapped} mapped
        </Badge>
      </div>

      {!hasIssues ? (
        <p className="mt-4 text-sm text-zinc-500">No security findings matched OWASP categories.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {summary.categories.map((cat) => (
            <div key={cat.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">{cat.code}</Badge>
                <p className="font-medium">{cat.name}</p>
                <span className="text-xs text-zinc-500">({cat.count})</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{cat.description}</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-400">
                {cat.findings.map((f) => (
                  <li key={f.findingId}>
                    <span className="text-zinc-300">[{f.severity}] {f.title}</span>
                    {f.filePath ? <span className="text-zinc-600"> — {f.filePath}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {summary.unmappedCount ? (
            <p className="text-xs text-zinc-600">
              {summary.unmappedCount} finding(s) did not match an OWASP keyword — see full findings below.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
