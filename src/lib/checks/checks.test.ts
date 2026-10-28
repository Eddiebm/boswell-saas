import { describe, expect, it } from "vitest";
import { checkEnvVars } from "@/lib/checks/env-vars";
import { checkIntegrations } from "@/lib/checks/integrations";
import { checkOutbound } from "@/lib/checks/outbound";
import { checkRefreshWipe } from "@/lib/checks/refresh-wipe";
import { checkSecretExposure } from "@/lib/checks/secrets";
import { annotateSiblings } from "@/lib/checks/siblings";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content: string): RepoFile => ({ path, content });
const pkg = (deps: Record<string, string>) => file("package.json", JSON.stringify({ name: "app", dependencies: deps }));

describe("checkIntegrations", () => {
  it("flags Sentry with a server config that no instrumentation.ts loads", () => {
    const findings = checkIntegrations([
      pkg({ "@sentry/nextjs": "^10.0.0", next: "15.0.0" }),
      file("sentry.server.config.ts", 'import * as Sentry from "@sentry/nextjs";\nSentry.init({ dsn: process.env.SENTRY_DSN });'),
      file("sentry.client.config.ts", 'import * as Sentry from "@sentry/nextjs";\nSentry.init({});'),
    ]);
    const sentry = findings.find((f) => f.title.startsWith("Sentry"));
    expect(sentry?.severity).toBe("MEDIUM");
    expect(sentry?.description).toContain("`sentry.server.config.ts` exists, but there's no `instrumentation.ts`");
  });

  it("accepts Sentry once instrumentation files register it", () => {
    const findings = checkIntegrations([
      pkg({ "@sentry/nextjs": "^10.0.0" }),
      file("src/instrumentation.ts", 'export async function register() { await import("../sentry.server.config"); }'),
      file("instrumentation-client.ts", 'import * as Sentry from "@sentry/nextjs"; Sentry.init({});'),
    ]);
    expect(findings.filter((f) => f.title.startsWith("Sentry"))).toEqual([]);
  });

  it("flags a rate limiter that is imported but never applied", () => {
    const findings = checkIntegrations([
      pkg({ "@upstash/ratelimit": "^2.0.0" }),
      file("lib/limit.ts", 'import { Ratelimit } from "@upstash/ratelimit";\nexport const rl = new Ratelimit({});'),
    ]);
    expect(findings.map((f) => f.title)).toContain("Rate limiting is installed but never applied");
  });

  it("lists production dependencies nothing imports, ignoring CLIs and convention-loaded packages", () => {
    const findings = checkIntegrations([
      file("package.json", JSON.stringify({ dependencies: { zod: "^4", "date-fns": "^4", next: "16", tailwindcss: "4", tsx: "4", "react-markdown": "10" }, scripts: { seed: "tsx seed.ts" } })),
      file("app/page.tsx", 'import Markdown from "react-markdown";'),
      file("app/globals.css", '@import "tailwindcss";'),
    ]);
    const unused = findings.find((f) => f.title.includes("never used"));
    expect(unused?.description).toContain("`zod`");
    expect(unused?.description).toContain("`date-fns`");
    expect(unused?.description).not.toContain("`react-markdown`");
    expect(unused?.description).not.toContain("`next`");
    expect(unused?.severity).toBe("INFO");
  });
});

describe("checkEnvVars", () => {
  it("lists variables the code reads that no .env example or README documents", () => {
    const [finding] = checkEnvVars([
      file(".env.example", "DATABASE_URL=\n# STRIPE_SECRET_KEY=sk_test_...\n"),
      file("README.md", "Set `RESEND_API_KEY` to send email."),
      file("lib/db.ts", "const url = process.env.DATABASE_URL; const s = process.env.STRIPE_SECRET_KEY; if (process.env.NODE_ENV) {}"),
      file("lib/mail.ts", 'const key = process.env["RESEND_API_KEY"]; const from = process.env.RESEND_FROM;'),
      file("app/api/x/route.ts", "const t = process.env.CRON_SECRET;"),
    ]);
    expect(finding.title).toBe("2 environment variables are missing from .env.example");
    expect(finding.description).toContain("`CRON_SECRET`");
    expect(finding.description).toContain("`RESEND_FROM` — read in lib/mail.ts:1");
    expect(finding.description).not.toContain("DATABASE_URL");
    expect(finding.description).not.toContain("NODE_ENV");
  });

  it("is louder when there's no .env example at all", () => {
    const [finding] = checkEnvVars([file("lib/a.ts", "process.env.A_KEY; process.env.B_KEY; process.env.C_KEY;")]);
    expect(finding.severity).toBe("MEDIUM");
    expect(finding.title).toContain("No .env.example");
  });
});

describe("checkOutbound", () => {
  it("flags a route that fetches a caller-influenced URL, but not fixed-host templates", () => {
    const findings = checkOutbound([
      file(
        "app/api/preview/route.ts",
        [
          "export async function POST(req: Request) {",
          "  const { url } = await req.json();",
          "  const api = `https://api.unsplash.com/search?q=${encodeURIComponent(url)}`;",
          "  await fetch(api, { signal: AbortSignal.timeout(5000) });",
          "  const res = await fetch(url);",
          "  return Response.json(await res.text());",
          "}",
        ].join("\n"),
      ),
    ]);
    const ssrf = findings.filter((f) => f.title.startsWith("Possible SSRF"));
    expect(ssrf).toHaveLength(1);
    expect(ssrf[0].lineStart).toBe(5);
    expect(ssrf[0].confidence).toBeLessThan(0.8);
  });

  it("treats a template on a constant base as fixed, unless the path could change the host", () => {
    const route = (lines: string[]) =>
      checkOutbound([file("app/api/p/route.ts", ["export async function GET(req: Request) {", "  const path = new URL(req.url).searchParams.get('path');", ...lines, "}"].join("\n"))]).filter((f) =>
        f.title.startsWith("Possible SSRF"),
      );
    // Literal base with a path, env/literal host followed by "/", and new URL() over such a template.
    expect(route(["  const PC = 'https://nubela.co/proxycurl/api';", "  await fetch(`${PC}${path}`, { signal });"])).toEqual([]);
    expect(route(["  const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';", "  await fetch(`${BACKEND}/${path}`, { signal });"])).toEqual([]);
    expect(route(["  const PC = 'https://nubela.co/proxycurl/api';", "  const url = new URL(`${PC}${path}`);", "  await fetch(url.toString(), { signal });"])).toEqual([]);
    // A bare host with the caller's path glued on: `?path=@evil.com` changes the host.
    expect(route(["  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';", "  await fetch(`${backendUrl}${path}`, { signal });"])).toHaveLength(1);
  });

  it("trusts routes that validate destinations", () => {
    const findings = checkOutbound([
      file("app/api/preview/route.ts", "const ALLOWED_HOSTS = ['a.com'];\nexport async function GET(req) { const u = new URL(req.nextUrl.searchParams.get('u')); if (!ALLOWED_HOSTS.includes(u.hostname)) return; await fetch(u); }"),
    ]);
    expect(findings.filter((f) => f.title.startsWith("Possible SSRF"))).toEqual([]);
  });

  it("collects server-side requests without a timeout, skipping client code and CLI scripts", () => {
    const findings = checkOutbound([
      file("lib/github.ts", 'export const get = () => fetch("https://api.github.com/user");'),
      file("components/x.tsx", '"use client";\nfetch("https://api.example.com");'),
      file("scripts/seed.mjs", 'await fetch("https://api.example.com");'),
      file("lib/ok.ts", 'fetch("https://api.example.com", { signal: AbortSignal.timeout(1000) });'),
    ]);
    const timeouts = findings.find((f) => f.title.includes("no timeout"));
    expect(timeouts?.title).toBe("1 outbound request has no timeout");
    expect(timeouts?.description).toContain("lib/github.ts:1");
  });
});

describe("checkSecretExposure", () => {
  const schema = file(
    "src/db/schema.ts",
    'export const users = pgTable("users", {\n  id: uuid("id"),\n  email: text("email"),\n  passwordHash: text("password_hash"),\n  tokensUsed: integer("tokens_used"),\n});',
  );

  it("flags a route that returns full rows of a table with secret columns", () => {
    const findings = checkSecretExposure([
      schema,
      file("app/api/me/route.ts", "export async function GET() {\n  const [user] = await db.select().from(users).where(eq(users.id, id));\n  return NextResponse.json(user);\n}"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("`passwordHash`");
    expect(findings[0].title).not.toContain("tokensUsed");
    expect(findings[0].lineStart).toBe(2);
  });

  it("stays quiet when the route selects columns or handles the secret column itself", () => {
    const findings = checkSecretExposure([
      schema,
      file("app/api/a/route.ts", "const rows = await db.select({ id: users.id }).from(users); return NextResponse.json(rows);"),
      file("app/api/b/route.ts", "const [u] = await db.select().from(users); const { passwordHash, ...safe } = u; return NextResponse.json(safe);"),
    ]);
    expect(findings).toEqual([]);
  });

  it("only flags rows that go into the response whole", () => {
    const route = (body: string) => checkSecretExposure([schema, file("app/api/x/route.ts", body)]);
    // Picked fields, or a row only used to decide something.
    expect(route("const rows = await db.select().from(users); return NextResponse.json(rows.map((r) => ({ id: r.id })));")).toEqual([]);
    expect(route("const [user] = await db.select().from(users).limit(1); if (user) await send(user.email); return Response.json({ ok: true });")).toEqual([]);
    // A query chain split across lines.
    expect(route("const [user] = await db\n    .select()\n    .from(users)\n    .limit(1);\nawait openPr(user.name);\nreturn NextResponse.json({ ok: true });")).toEqual([]);
    expect(route("const [user] = await db\n    .select()\n    .from(users);\nreturn NextResponse.json(user);")).toHaveLength(1);
    // Whole, wrapped, spread, or inline.
    expect(route("const rows = await db.select().from(users); return NextResponse.json({ data: rows });")).toHaveLength(1);
    expect(route("const [user] = await db.select().from(users); return NextResponse.json({ user });")).toHaveLength(1);
    expect(route("const [user] = await db.select().from(users); return NextResponse.json({ ...user, extra: 1 });")).toHaveLength(1);
    expect(route("return NextResponse.json(await db.select().from(users));")).toHaveLength(1);
  });

  it("flags Prisma reads without select/omit", () => {
    const findings = checkSecretExposure([
      file("prisma/schema.prisma", "model User {\n  id String @id\n  password String\n}\n"),
      file("pages/api/user.ts", "export default async function h(req, res) { const u = await prisma.user.findUnique({ where: { id } }); res.json(u); }"),
    ]);
    expect(findings[0]?.title).toContain("`User`");
  });

  it("flags secrets put in browser-exposed env vars", () => {
    const findings = checkSecretExposure([file("lib/supabase.ts", "createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!)")]);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("checkRefreshWipe", () => {
  const verify = file("src/lib/verify/run.ts", "await db.insert(fixQueueItems).values(items);");

  it("flags a delete-and-reinsert refresh of a table another feature also writes", () => {
    const findings = checkRefreshWipe([
      file(
        "src/lib/audits.ts",
        "await db\n  .delete(fixQueueItems)\n  .where(and(eq(fixQueueItems.repositoryId, repo.id), eq(fixQueueItems.status, \"pending\")));\nawait db.insert(fixQueueItems).values(queue);",
      ),
      verify,
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].lineStart).toBe(2);
    expect(findings[0].description).toContain("src/lib/verify/run.ts");
  });

  it("accepts a refresh scoped to its own rows, or a table nobody else writes", () => {
    expect(
      checkRefreshWipe([
        file("src/lib/audits.ts", 'await db.delete(fixQueueItems).where(and(eq(fixQueueItems.repositoryId, id), eq(fixQueueItems.source, "audit")));\nawait db.insert(fixQueueItems).values(q);'),
        verify,
      ]),
    ).toEqual([]);
    expect(checkRefreshWipe([file("src/lib/scores.ts", "await db.delete(repoScores).where(eq(repoScores.repositoryId, id));\nawait db.insert(repoScores).values(s);")])).toEqual([]);
  });

  it("understands Prisma and raw SQL", () => {
    expect(
      checkRefreshWipe([
        file("jobs/sync.ts", "await prisma.task.deleteMany({ where: { projectId } });\nawait prisma.task.createMany({ data });"),
        file("api/tasks.ts", "await prisma.task.create({ data });"),
      ]),
    ).toHaveLength(1);
    expect(
      checkRefreshWipe([
        file("jobs/sync.py", 'cur.execute("DELETE FROM tasks")\ncur.execute("INSERT INTO tasks VALUES (%s)")'),
        file("api/tasks.py", 'cur.execute("INSERT INTO tasks (name) VALUES (%s)")'),
      ])[0]?.description,
    ).toContain("no `where`");
  });
});

describe("annotateSiblings", () => {
  const line = "  const res = await fetch(url, { headers: { cookie } });";
  it("points out copies of a flagged line in other files", () => {
    const files = [file("a.ts", `x\n${line}`), file("b.ts", `${line}\n`), file("c.ts", "nothing here")];
    const [annotated] = annotateSiblings([{ filePath: "a.ts", lineStart: 2, description: "Bug." }], files);
    expect(annotated.description).toContain("The same line also appears in b.ts:1");
  });

  it("ignores short lines, boilerplate, and lines common enough to be an idiom", () => {
    const common = Array.from({ length: 7 }, (_, i) => file(`f${i}.ts`, line));
    const imports = [file("a.ts", 'import { something } from "@/lib/something-long";'), file("b.ts", 'import { something } from "@/lib/something-long";')];
    expect(annotateSiblings([{ filePath: "f0.ts", lineStart: 1, description: "Bug." }], common)[0].description).toBe("Bug.");
    expect(annotateSiblings([{ filePath: "a.ts", lineStart: 1, description: "Bug." }], imports)[0].description).toBe("Bug.");
  });
});
