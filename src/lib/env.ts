import { isDemoMode } from "@/lib/demo/mode";

export type EnvCheck = {
  name: string;
  status: "ok" | "missing" | "demo" | "manual";
  detail: string;
};

export function getEnvChecks(): EnvCheck[] {
  const demo = isDemoMode();
  return [
    {
      name: "Mode",
      status: demo ? "demo" : "ok",
      detail: demo ? "Demo mode (BOSWELL_DEMO=1)" : "Live mode",
    },
    {
      name: "Database",
      status: process.env.DATABASE_URL ? "ok" : "missing",
      detail: process.env.DATABASE_URL ? "DATABASE_URL set" : "Required for live mode",
    },
    {
      name: "Auth secret",
      status: process.env.AUTH_SECRET ? "ok" : "missing",
      detail: "AUTH_SECRET for NextAuth sessions",
    },
    {
      name: "GitHub OAuth",
      status:
        process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
          ? "ok"
          : process.env.GITHUB_BOOTSTRAP_TOKEN
            ? "ok"
            : "missing",
      detail:
        process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
          ? "AUTH_GITHUB_ID + AUTH_GITHUB_SECRET"
          : process.env.GITHUB_BOOTSTRAP_TOKEN
            ? "Owner bootstrap token (GITHUB_BOOTSTRAP_TOKEN)"
            : "AUTH_GITHUB_ID + AUTH_GITHUB_SECRET or GITHUB_BOOTSTRAP_TOKEN",
    },
    {
      name: "OpenRouter",
      status: process.env.OPENROUTER_API_KEY ? "ok" : "missing",
      detail: "Required on worker for Boswell engine LLM audits",
    },
    {
      name: "Worker secret",
      status: process.env.WORKER_SECRET ? "ok" : "missing",
      detail: "WORKER_SECRET for /api/worker/tick",
    },
    {
      name: "Boswell engine",
      status: "ok",
      detail: process.env.BOSWELL_ENGINE_GIT_URL ?? "git+https://github.com/Eddiebm/boswell.git",
    },
    {
      name: "Worker process",
      status: "ok",
      detail: "GitHub Actions runs audit-worker.yml every 2 minutes (cloud)",
    },
    {
      name: "Failure alerts",
      status:
        process.env.ADMIN_ALERT_EMAIL && process.env.RESEND_API_KEY ? "ok" : "manual",
      detail:
        process.env.ADMIN_ALERT_EMAIL && process.env.RESEND_API_KEY
          ? `Email alerts → ${process.env.ADMIN_ALERT_EMAIL}`
          : "Set ADMIN_ALERT_EMAIL + RESEND_API_KEY for audit failure emails",
    },
    {
      name: "Stripe",
      status: process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO ? "ok" : "manual",
      detail:
        process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO
          ? "Stripe configured for Pro upgrades"
          : "Set STRIPE_SECRET_KEY + STRIPE_PRICE_PRO for paid plans",
    },
  ];
}
