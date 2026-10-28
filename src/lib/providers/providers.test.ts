import { describe, expect, it } from "vitest";
import { checkDatabaseRules } from "@/lib/checks/database-rules";
import type { RepoFile } from "@/lib/checks/types";
import { runProviderChecks, type ProviderConnection, type ProviderFetch } from "@/lib/providers";

const file = (path: string, content: string): RepoFile => ({ path, content });

/** Routes requests to canned JSON by URL suffix and records them. */
function fakeApi(routes: Record<string, { status?: number; json: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: unknown; token: string }> = [];
  const fetcher: ProviderFetch = async (url, init) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body, token: init.token });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404, json: null };
    return { status: route.status ?? 200, json: route.json };
  };
  return { fetcher, calls };
}

const conn = (provider: ProviderConnection["provider"], projectRef = "proj_1"): ProviderConnection => ({ provider, projectRef, token: "tok_secret" });

describe("Supabase connector", () => {
  it("reads RLS through the read-only SQL endpoint, plus backups and project status", async () => {
    const { fetcher, calls } = fakeApi({
      "/database/query/read-only": { status: 201, json: [{ table_name: "profiles", rls_enabled: true }, { table_name: "orders", rls_enabled: false }] },
      "/database/backups": { json: { region: "us-east-1", walg_enabled: false, pitr_enabled: false, backups: [] } },
      "/v1/projects/proj_1": { json: { status: "INACTIVE", name: "shop" } },
    });
    const result = await runProviderChecks([conn("supabase")], [], fetcher);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["ops.db-paused", "db.rls-disabled", "ops.no-backups"]);
    expect(result.findings[1].description).toContain("`orders`");
    expect(result.findings[1].description).not.toContain("profiles");
    expect(result.coverage).toEqual({ databaseRules: "checked", backups: "checked" });
    const query = calls.find((c) => c.url.endsWith("/read-only"));
    expect(query?.method).toBe("POST");
    expect((query?.body as { query: string }).query).toMatch(/relrowsecurity/);
    expect(calls.every((c) => c.method === "GET" || c.url.endsWith("/database/query/read-only"))).toBe(true);
  });

  it("keeps a proven RLS hole when a later call fails", async () => {
    const { fetcher } = fakeApi({
      "/database/query/read-only": { json: [{ table_name: "orders", rls_enabled: false }] },
      "/database/backups": { status: 403, json: { message: "forbidden" } },
      "/v1/projects/proj_1": { json: { status: "ACTIVE_HEALTHY" } },
    });
    const result = await runProviderChecks([conn("supabase")], [], fetcher);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["db.rls-disabled", "provider.unreachable"]);
    expect(result.findings[1].description).toContain("Supabase backups returned 403");
    expect(result.findings[1].description).toContain("token was rejected");
    expect(result.coverage).toEqual({ databaseRules: "checked" });
  });

  it("doesn't count an unreadable query response as a clean database", async () => {
    for (const json of [{ unexpected: true }, [{ tablename: "orders" }], { result: "nope" }]) {
      const { fetcher } = fakeApi({
        "/database/query/read-only": { json },
        "/database/backups": { json: { pitr_enabled: true, backups: [] } },
        "/v1/projects/proj_1": { json: { status: "ACTIVE_HEALTHY" } },
      });
      const result = await runProviderChecks([conn("supabase")], [], fetcher);
      expect(result.coverage.databaseRules).toBeUndefined();
      expect(result.findings.map((f) => f.ruleId)).toEqual(["provider.unreachable"]);
      expect(result.findings[0].description).toContain("couldn't read");
    }
  });
});

describe("Vercel connector", () => {
  it("compares production env var names with what the code reads, and flags a failed production deploy", async () => {
    const { fetcher } = fakeApi({
      "/env": { json: { envs: [{ key: "DATABASE_URL", target: ["production", "preview"] }, { key: "STRIPE_SECRET_KEY", target: "preview" }] } },
      "/v7/deployments": { json: { deployments: [{ readyState: "ERROR", url: "shop-abc.vercel.app" }] } },
    });
    const files = [
      file("app/api/pay/route.ts", "process.env.DATABASE_URL; process.env.STRIPE_SECRET_KEY;"),
      file("scripts/seed.ts", "process.env.SEED_ONLY"),
    ];
    const result = await runProviderChecks([{ ...conn("vercel"), teamId: "team_1" }], files, fetcher);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["deploy.env-missing-prod", "ops.deploy-failing"]);
    expect(result.findings[0].description).toContain("`STRIPE_SECRET_KEY`");
    expect(result.findings[0].description).not.toContain("DATABASE_URL");
    expect(result.findings[0].description).not.toContain("SEED_ONLY");
    expect(result.coverage).toEqual({ productionEnv: "checked" });
  });

  it("leaves production settings unverified when the env call fails, but still reports the deploy", async () => {
    const { fetcher } = fakeApi({
      "/env": { status: 403, json: { error: { code: "forbidden" } } },
      "/v7/deployments": { json: { deployments: [{ readyState: "ERROR" }] } },
    });
    const result = await runProviderChecks([conn("vercel")], [file("app/page.tsx", "process.env.API_KEY")], fetcher);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["ops.deploy-failing", "provider.unreachable"]);
    expect(result.coverage).toEqual({});
  });
});

describe("Neon connector", () => {
  it("reads the restore window, branch protection and the security advisor", async () => {
    const { fetcher, calls } = fakeApi({
      "/branches": { json: { branches: [{ name: "main", default: true, protected: false }, { name: "dev", default: false, protected: false }] } },
      "/advisors": { json: { issues: [{ name: "rls_disabled_in_public", title: "RLS Disabled in Public", level: "ERROR", description: "Table public.notes has RLS off" }] } },
      "/projects/proj_1": { json: { project: { name: "app", history_retention_seconds: 6 * 3600 } } },
    });
    const result = await runProviderChecks([conn("neon")], [], fetcher);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["ops.short-backups", "ops.branch-unprotected", "db.rls-disabled"]);
    expect(result.findings[0].title).toBe("You can only restore the last 6 hours of your Neon database");
    expect(result.coverage).toEqual({ backups: "checked" });
    expect(calls.every((c) => c.method === "GET" && c.url.startsWith("https://console.neon.tech/api/v2/"))).toBe(true);
  });

  it("reports an unreachable provider instead of passing", async () => {
    const { fetcher } = fakeApi({ "/projects/proj_1": { status: 401, json: { message: "unauthorized" } } });
    const result = await runProviderChecks([conn("neon")], [], fetcher);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ ruleId: "provider.unreachable", title: "Couldn't read Neon" });
    expect(result.findings[0].description).toContain("token was rejected");
    expect(result.coverage).toEqual({});
  });
});

describe("server-side database checks (Neon, Postgres, Prisma…)", () => {
  const pkg = (deps: Record<string, string>) => file("package.json", JSON.stringify({ dependencies: deps }));

  it("flags a database driver in browser code and sslmode=disable", () => {
    const result = checkDatabaseRules([
      pkg({ next: "16", "@neondatabase/serverless": "1" }),
      file("components/stats.tsx", '"use client";\nimport { neon } from "@neondatabase/serverless";\nconst sql = neon(process.env.NEXT_PUBLIC_DATABASE_URL!);'),
      file("drizzle.config.ts", 'url: "postgresql://u@ep-x.neon.tech/db?sslmode=disable"'),
    ]);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["db.client-database", "db.ssl-disabled"]);
    expect(result.coverage).toBe("not-applicable"); // no browser-facing database API to protect with RLS
  });

  it("ignores type-only imports in client components — they're erased at build time", () => {
    const typeOnly = [
      '"use client";\nimport type { User } from "@prisma/client";',
      '"use client";\nimport { type User, type Post } from "@prisma/client";',
      '"use client"\nimport React from "react"\nimport type { Pool } from "pg"\n',
    ];
    for (const content of typeOnly) expect(checkDatabaseRules([file("components/user.tsx", content)]).findings).toEqual([]);
    const runtime = ['"use client";\nimport { PrismaClient, type User } from "@prisma/client";', '"use client";\nconst { Pool } = require("pg");', '"use client";\nimport "pg";'];
    for (const content of runtime) expect(checkDatabaseRules([file("components/user.tsx", content)]).findings.map((f) => f.ruleId)).toEqual(["db.client-database"]);
  });

  it("suggests Neon's pooled endpoint for a TCP driver on serverless, but not when pooling is used", () => {
    const files = (url: string) => [
      pkg({ next: "16", pg: "8" }),
      file("lib/db.ts", 'import { Pool } from "pg";'),
      file(".env.example", `DATABASE_URL=${url}`),
    ];
    expect(checkDatabaseRules(files("postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/db")).findings.map((f) => f.ruleId)).toEqual(["db.not-pooled"]);
    expect(checkDatabaseRules(files("postgresql://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/db")).findings).toEqual([]);
  });

  it("checks RLS in migrations for apps using Neon's Data API", () => {
    const result = checkDatabaseRules([
      pkg({ "@neondatabase/neon-js": "1" }),
      file("migrations/001.sql", "create table notes (id uuid);"),
    ]);
    expect(result.findings[0].title).toBe("1 Neon Data API table has no row level security");
    expect(result.coverage).toBe("checked");
  });
});
