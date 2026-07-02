export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { getEnvChecks } from "@/lib/env";
import { getWorkerHealth } from "@/lib/data";
import { isDemoMode } from "@/lib/demo/mode";

export default async function AdminPage() {
  const checks = getEnvChecks();
  const worker = isDemoMode() ? null : await getWorkerHealth();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">System health</h1>
      <div className="grid gap-3">
        {checks.map((c) => (
          <Card key={c.name} className="flex items-center justify-between">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-zinc-400">{c.detail}</p>
            </div>
            <span
              className={
                c.status === "ok"
                  ? "text-emerald-400"
                  : c.status === "demo" || c.status === "manual"
                    ? "text-amber-400"
                    : "text-red-400"
              }
            >
              {c.status}
            </span>
          </Card>
        ))}
      </div>

      {worker ? (
        <Card>
          <h2 className="mb-3 font-medium">Audit queue</h2>
          <p className="text-sm text-zinc-400">Queued: {worker.queuedAudits}</p>
          <p className="text-sm text-zinc-400">Running: {worker.runningAudits}</p>
          {worker.recentFailures?.length ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-red-300">Recent failures</p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                {worker.recentFailures.map((f) => (
                  <li key={f.id}>
                    {f.id}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
