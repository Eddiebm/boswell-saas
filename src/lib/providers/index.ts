import { findEnvRefs } from "@/lib/checks/env-vars";
import type { Coverage } from "@/lib/checks";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

/**
 * Read-only checks against the services an app runs on — what can only be
 * seen in their dashboards, not in the code. Every call is a GET, except
 * Supabase's dedicated read-only SQL endpoint (a read-only database role).
 */

export type ProviderName = "supabase" | "vercel" | "neon";
export type ProviderConnection = { provider: ProviderName; projectRef: string; teamId?: string | null; token: string };

export type ProviderFetch = (url: string, init: { method?: "GET" | "POST"; token: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;

export const defaultProviderFetch: ProviderFetch = async (url, init) => {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${init.token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  return { status: res.status, json };
};

export type ProviderCoverage = { databaseRules?: Coverage; backups?: Coverage; productionEnv?: Coverage };
export type ProviderResult = { findings: CheckFinding[]; coverage: ProviderCoverage };

class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly status: number,
    what: string,
  ) {
    super(`${what} returned ${status}`);
  }
}

async function getJson(fetcher: ProviderFetch, conn: ProviderConnection, url: string, what: string, body?: unknown) {
  const res = await fetcher(url, { method: body ? "POST" : "GET", token: conn.token, body });
  if (res.status < 200 || res.status >= 300) throw new ProviderError(conn.provider, res.status, what);
  return res.json;
}

const enc = encodeURIComponent;

/* ---------------- Supabase ---------------- */

const RLS_QUERY = `select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 1`;

function rows(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  const result = (json as { result?: unknown } | null)?.result;
  return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
}

export async function checkSupabase(conn: ProviderConnection, fetcher: ProviderFetch): Promise<ProviderResult> {
  const base = `https://api.supabase.com/v1/projects/${enc(conn.projectRef)}`;
  const findings: CheckFinding[] = [];
  const coverage: ProviderCoverage = {};

  const project = (await getJson(fetcher, conn, base, "Supabase project")) as { status?: string; name?: string };
  if (project.status && /INACTIVE|PAUSED/.test(project.status)) {
    findings.push({
      ruleId: "ops.db-paused",
      severity: "HIGH",
      category: "operations",
      title: "Your Supabase project is paused",
      description: `Supabase reports the project${project.name ? ` "${project.name}"` : ""} as ${project.status}, so its database and APIs are offline — and so is every part of the app that uses them. Free-tier projects pause after a week without activity.`,
      recommendation: "Restore it from the Supabase dashboard, and before launch upgrade to a paid plan (or make sure something uses the database every day).",
      confidence: 0.95,
    });
  }

  const tables = rows(await getJson(fetcher, conn, `${base}/database/query/read-only`, "Supabase read-only query", { query: RLS_QUERY }));
  const open = tables.filter((t) => t.rls_enabled === false).map((t) => String(t.table_name));
  coverage.databaseRules = "checked";
  if (open.length) {
    findings.push({
      ruleId: "db.rls-disabled",
      severity: "CRITICAL",
      category: "database",
      title: `${open.length} live Supabase ${open.length === 1 ? "table has" : "tables have"} row level security off`,
      description: `Read from your live database: these public tables have RLS disabled, so anyone with your (public) anon key can read and change every row:\n\n${open
        .slice(0, 20)
        .map((t) => `- \`${t}\``)
        .join("\n")}${open.length > 20 ? `\n- …and ${open.length - 20} more` : ""}`,
      recommendation: "For each table, run `alter table <name> enable row level security;` and add policies so users reach only their own rows (e.g. `using (auth.uid() = user_id)`).",
      confidence: 0.98,
    });
  }

  const backups = (await getJson(fetcher, conn, `${base}/database/backups`, "Supabase backups")) as { pitr_enabled?: boolean; backups?: unknown[] };
  if (typeof backups.pitr_enabled === "boolean" || Array.isArray(backups.backups)) {
    coverage.backups = "checked";
    if (!backups.pitr_enabled && !(backups.backups ?? []).length) {
      findings.push({
        ruleId: "ops.no-backups",
        severity: "HIGH",
        category: "operations",
        title: "Your Supabase database has no backups",
        description: "Supabase reports no backups and no point-in-time recovery for this project (the free plan includes none). One bad migration or deleted table would be permanent.",
        recommendation: "Upgrade to a plan with daily backups (or add point-in-time recovery), or schedule your own `pg_dump` to storage you control. Restore one once to prove it works.",
        confidence: 0.9,
      });
    }
  }
  return { findings, coverage };
}

/* ---------------- Vercel ---------------- */

type VercelEnv = { key?: string; target?: string[] | string };

export async function checkVercel(conn: ProviderConnection, files: RepoFile[], fetcher: ProviderFetch): Promise<ProviderResult> {
  const team = conn.teamId ? `&teamId=${enc(conn.teamId)}` : "";
  const findings: CheckFinding[] = [];

  const envBody = (await getJson(fetcher, conn, `https://api.vercel.com/v10/projects/${enc(conn.projectRef)}/env?decrypt=false${team}`, "Vercel environment variables")) as {
    envs?: VercelEnv[];
  };
  const envs = Array.isArray(envBody.envs) ? envBody.envs : [];
  const inProduction = new Set(envs.filter((e) => e.key && (Array.isArray(e.target) ? e.target : [e.target]).includes("production")).map((e) => e.key!));

  // Variables the running app reads (not one-off scripts or tests), compared with what production actually has.
  const needed = new Map<string, string>();
  for (const ref of findEnvRefs(files)) {
    if (/^(?:scripts|bin|tools|e2e|tests?)\//.test(ref.file) || /\.(?:test|spec)\./.test(ref.file)) continue;
    if (!needed.has(ref.name)) needed.set(ref.name, `${ref.file}:${ref.line}`);
  }
  const missing = [...needed.entries()].filter(([name]) => !inProduction.has(name)).sort(([a], [b]) => a.localeCompare(b));
  if (missing.length) {
    findings.push({
      ruleId: "deploy.env-missing-prod",
      severity: "HIGH",
      category: "deploy",
      title: `${missing.length} environment ${missing.length === 1 ? "variable the code reads is" : "variables the code reads are"} not set in Vercel production`,
      description: `Read from your Vercel project: production has no value for:\n\n${missing
        .slice(0, 20)
        .map(([name, at]) => `- \`${name}\` — read in ${at}`)
        .join("\n")}${missing.length > 20 ? `\n- …and ${missing.length - 20} more` : ""}\n\nWhatever uses them will fail in production (some may be optional, or only set in preview).`,
      recommendation: "Add each one under Vercel → Project → Settings → Environment Variables with the Production environment ticked, then redeploy.",
      confidence: 0.85,
    });
  }

  const deployBody = (await getJson(fetcher, conn, `https://api.vercel.com/v7/deployments?projectId=${enc(conn.projectRef)}&target=production&limit=1${team}`, "Vercel deployments")) as {
    deployments?: Array<{ readyState?: string; state?: string; url?: string; created?: number }>;
  };
  const latest = deployBody.deployments?.[0];
  const state = latest?.readyState ?? latest?.state;
  if (state === "ERROR" || state === "CANCELED") {
    findings.push({
      ruleId: "ops.deploy-failing",
      severity: "HIGH",
      category: "operations",
      title: "The latest production deployment failed",
      description: `Vercel reports the most recent production deployment${latest?.url ? ` (${latest.url})` : ""} as ${state}. Your changes aren't live, and the site is still serving an older version.`,
      recommendation: "Open the deployment's build logs in Vercel, fix the error, and redeploy.",
      confidence: 0.95,
    });
  }
  return { findings, coverage: { productionEnv: "checked" } };
}

/* ---------------- Neon ---------------- */

export async function checkNeon(conn: ProviderConnection, fetcher: ProviderFetch): Promise<ProviderResult> {
  const base = `https://console.neon.tech/api/v2/projects/${enc(conn.projectRef)}`;
  const findings: CheckFinding[] = [];
  const coverage: ProviderCoverage = {};

  const { project } = (await getJson(fetcher, conn, base, "Neon project")) as { project?: { name?: string; history_retention_seconds?: number } };
  const retention = project?.history_retention_seconds;
  if (typeof retention === "number") {
    coverage.backups = "checked";
    const hours = Math.floor(retention / 3600);
    if (retention === 0) {
      findings.push({
        ruleId: "ops.no-backups",
        severity: "HIGH",
        category: "operations",
        title: "Your Neon database can't be restored to an earlier point",
        description: "Neon's restore window (history retention) is set to zero, so there's no point-in-time restore: a bad migration or deleted table can't be undone.",
        recommendation: "Raise the history retention in Neon → Project settings (at least 24 hours; 7 days on paid plans), or schedule your own `pg_dump` backups.",
        confidence: 0.9,
      });
    } else if (retention < 24 * 3600) {
      findings.push({
        ruleId: "ops.short-backups",
        severity: "MEDIUM",
        category: "operations",
        title: `You can only restore the last ${hours} ${hours === 1 ? "hour" : "hours"} of your Neon database`,
        description: `Neon keeps ${hours} ${hours === 1 ? "hour" : "hours"} of history. A mistake noticed the next morning can't be undone.`,
        recommendation: "Raise history retention to at least 24 hours (7 days on paid plans) in Neon → Project settings.",
        confidence: 0.9,
      });
    }
  }

  const { branches } = (await getJson(fetcher, conn, `${base}/branches`, "Neon branches")) as { branches?: Array<{ name?: string; default?: boolean; protected?: boolean }> };
  const main = branches?.find((b) => b.default);
  if (main && main.protected === false) {
    findings.push({
      ruleId: "ops.branch-unprotected",
      severity: "LOW",
      category: "operations",
      title: `Neon's production branch "${main.name ?? "main"}" isn't protected`,
      description: "An unprotected default branch can be reset or deleted from the console, API or CLI in one step — by you, a script, or an AI agent with your API key.",
      recommendation: "Mark it as protected in Neon → Branches (available on paid plans).",
      confidence: 0.8,
    });
  }

  // Advisors need a database name when a branch has several; skip quietly rather than guess.
  const advisors = await fetcher(`${base}/advisors?category=SECURITY&min_severity=ERROR`, { token: conn.token });
  const issues = advisors.status === 200 ? ((advisors.json as { issues?: Array<{ name?: string; title?: string; description?: string; metadata?: { name?: string } }> })?.issues ?? []) : [];
  for (const issue of issues.slice(0, 10)) {
    findings.push({
      ruleId: issue.name === "rls_disabled_in_public" ? "db.rls-disabled" : "db.neon-advisor",
      severity: "HIGH",
      category: "database",
      title: `Neon security advisor: ${issue.title ?? issue.name ?? "issue"}${issue.metadata?.name ? ` (${issue.metadata.name})` : ""}`,
      description: issue.description ?? "Neon's security advisor flagged this as an error.",
      recommendation: "Open Neon → Advisors for the fix, apply it, and re-run the audit.",
      confidence: 0.9,
    });
  }
  return { findings, coverage };
}

/* ---------------- All providers ---------------- */

const NAMES: Record<ProviderName, string> = { supabase: "Supabase", vercel: "Vercel", neon: "Neon" };

export async function runProviderChecks(connections: ProviderConnection[], files: RepoFile[], fetcher: ProviderFetch = defaultProviderFetch): Promise<ProviderResult> {
  const findings: CheckFinding[] = [];
  const coverage: ProviderCoverage = {};
  for (const conn of connections) {
    try {
      const result =
        conn.provider === "supabase" ? await checkSupabase(conn, fetcher) : conn.provider === "vercel" ? await checkVercel(conn, files, fetcher) : await checkNeon(conn, fetcher);
      findings.push(...result.findings);
      for (const [key, value] of Object.entries(result.coverage) as Array<[keyof ProviderCoverage, Coverage]>) coverage[key] = value;
    } catch (error) {
      const status = error instanceof ProviderError ? error.status : null;
      findings.push({
        ruleId: "provider.unreachable",
        severity: "INFO",
        category: "operations",
        title: `Couldn't read ${NAMES[conn.provider]}`,
        description: `Boswell couldn't read your ${NAMES[conn.provider]} project (${error instanceof Error ? error.message : "request failed"}). ${status === 401 || status === 403 ? "The token was rejected or doesn't have access to this project." : ""}`.trim(),
        recommendation: `Check the project ID and token under Ship Ready → Connected services.`,
        confidence: 1,
      });
    }
  }
  return { findings, coverage };
}

export function providerLabel(p: ProviderName) {
  return NAMES[p];
}
