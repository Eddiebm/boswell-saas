import { Card } from "@/components/ui";

export function ScoreGauge({ score, label }: { score: number; label?: string }) {
  const color =
    score >= 750 ? "text-emerald-400" : score >= 500 ? "text-amber-400" : "text-red-400";

  return (
    <Card className="text-center">
      {label ? <p className="text-sm text-zinc-400">{label}</p> : null}
      <p className={`mt-2 text-5xl font-semibold tabular-nums ${color}`}>{score}</p>
      <p className="mt-1 text-xs text-zinc-500">out of 1000</p>
    </Card>
  );
}

export function DimensionBars({
  dimensions,
}: {
  dimensions: Record<string, number>;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(dimensions).map(([key, value]) => (
        <div key={key}>
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span className="capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
            <span>{value}</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-800">
            <div
              className="h-2 rounded-full bg-sky-500"
              style={{ width: `${Math.min(100, value / 10)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
