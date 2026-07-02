export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";

export default function AdminPage() {
  const checks = [
    { name: "Web app", status: "ok", detail: "Next.js build passing" },
    { name: "Database", status: process.env.DATABASE_URL ? "ok" : "demo", detail: process.env.DATABASE_URL ? "Neon connected" : "Demo mode (no DATABASE_URL)" },
    { name: "OpenRouter", status: process.env.OPENROUTER_API_KEY ? "ok" : "missing", detail: "Required for live audits" },
    { name: "Worker", status: "manual", detail: "Run npm run worker or deploy render.yaml" },
    { name: "GitHub OAuth", status: process.env.AUTH_GITHUB_ID ? "ok" : "missing", detail: "Required for sign-in" },
  ];

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
    </div>
  );
}
