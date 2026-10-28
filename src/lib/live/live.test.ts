import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAuthorization } from "@/lib/checks/authz";
import type { RepoFile } from "@/lib/checks/types";
import { runLiveChecks } from "@/lib/live";
import { exposedFields } from "@/lib/live/authz-sweep";
import { extractRoutes } from "@/lib/live/routes";
import { smokeFindings } from "@/lib/live/smoke";

const file = (path: string, content: string): RepoFile => ({ path, content });
const stripeLive = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");

describe("extractRoutes", () => {
  it("maps Next.js files to URLs, dropping route groups and private folders", () => {
    const { pages, api } = extractRoutes([
      file("src/app/page.tsx", ""),
      file("src/app/(marketing)/pricing/page.tsx", ""),
      file("app/blog/[slug]/page.tsx", ""),
      file("app/_components/page.tsx", ""),
      file("app/api/users/route.ts", ""),
      file("pages/api/legacy.ts", ""),
      file("pages/about.tsx", ""),
      file("pages/_app.tsx", ""),
    ]);
    expect(pages.map((p) => [p.path, p.dynamic])).toEqual([["/", false], ["/about", false], ["/blog/[slug]", true], ["/pricing", false]]);
    expect(api.map((p) => p.path)).toEqual(["/api/legacy", "/api/users"]);
  });
});

describe("checkAuthorization", () => {
  it("flags request bodies written straight to the database, but not picked fields", () => {
    const findings = checkAuthorization([
      file("app/api/profile/route.ts", "export async function PATCH(req: Request) {\n  const body = await req.json();\n  await db.update(users).set(body).where(eq(users.id, id));\n}"),
      file("app/api/settings/route.ts", "export async function PATCH(req: Request) {\n  const data = await req.json();\n  await prisma.user.update({ where: { id }, data: { ...data } });\n}"),
      file("app/api/safe/route.ts", "export async function PATCH(req: Request) {\n  const { name } = await req.json();\n  await db.update(users).set({ name });\n}"),
    ]);
    expect(findings.map((f) => [f.ruleId, f.filePath, f.lineStart])).toEqual([
      ["authz.mass-assignment", "app/api/profile/route.ts", 3],
      ["authz.mass-assignment", "app/api/settings/route.ts", 3],
    ]);
    expect(findings[0].confidence).toBeLessThan(0.8);
  });

  it("flags admin routes with no role check, unless the handler or middleware checks one", () => {
    const findings = checkAuthorization([
      file("app/api/admin/users/route.ts", "export async function GET() { const s = await auth(); if (!s) return; return Response.json(await db.select().from(users)); }"),
      file("app/api/admin/stats/route.ts", "export async function GET() { const s = await auth(); if (s.user.role !== 'admin') return; }"),
    ]);
    expect(findings.map((f) => f.ruleId)).toEqual(["authz.admin-unguarded"]);
    expect(findings[0].description).toContain("app/api/admin/users/route.ts");
    expect(findings[0].description).not.toContain("stats");
  });
});

describe("exposedFields and smokeFindings", () => {
  it("names the personal data a response exposes, without keeping it", () => {
    expect(exposedFields('[{"email":"a@x.com","name":"A"},{"email":"b@y.com"}]')).toEqual(["email", "2 email addresses"]);
    expect(exposedFields('{"ok":true,"email":null}')).toEqual([]);
  });

  it("doesn't call a login-protected page broken when Boswell has no session", () => {
    const base = { viewport: "desktop", loadMs: 500, pageErrors: [], consoleErrors: [], overflow: false, failed: null };
    const results = [
      { ...base, path: "/dashboard", status: 401 },
      { ...base, path: "/broken", status: 500 },
    ];
    expect(smokeFindings(results, false).map((f) => f.title)).toEqual(["1 page doesn't load on the live site"]);
    expect(smokeFindings(results, true)[0].title).toBe("2 pages don't load on the live site");
  });
});

// A deliberately unsafe little site.
let server: http.Server;
let baseUrl = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    const signedIn = (req.headers.cookie ?? "").includes("session=b");
    switch (req.url) {
      case "/":
        return send(200, "text/html", '<html><body><h1>Home</h1><script src="/app.js"></script></body></html>');
      case "/app.js":
        return send(200, "application/javascript", `const stripe = "${stripeLive}";\n//# sourceMappingURL=app.js.map`);
      case "/app.js.map":
        return send(200, "application/json", '{"version":3,"sources":["src/app.ts"],"mappings":""}');
      case "/.env":
        return send(200, "text/plain", "DATABASE_URL=postgres://x\nSTRIPE_SECRET_KEY=sk\n");
      case "/.git/HEAD":
        return send(200, "text/html", "<html>not found page</html>");
      case "/api/users":
        return send(200, "application/json", '[{"email":"ann@example.com"},{"email":"bob@example.com"}]');
      case "/api/admin/stats":
        return signedIn ? send(200, "application/json", '{"users":2}') : send(401, "application/json", '{"error":"unauthorized"}');
      case "/api/login":
        return send(200, "application/json", '{"ok":true}', { "set-cookie": "session=b; Path=/; HttpOnly" });
      case "/crash":
        return send(200, "text/html", "<html><body><script>window.boom.now()</script></body></html>");
      case "/wide":
        return send(200, "text/html", '<html><head><meta name="viewport" content="width=device-width"></head><body><div style="width:1500px">wide</div></body></html>');
      case "/broken":
        return send(500, "text/html", "<html>Internal error</html>");
      default:
        return send(404, "text/html", "<html>Not found</html>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const repoFiles = [
  file("app/page.tsx", ""),
  file("app/crash/page.tsx", ""),
  file("app/wide/page.tsx", ""),
  file("app/broken/page.tsx", ""),
  file("app/api/users/route.ts", "export async function GET() {}"),
  file("app/api/admin/stats/route.ts", "export async function GET() {}"),
];
const browserAvailable = fs.existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/nonexistent") || Boolean(process.env.BOSWELL_CHROMIUM_PATH);

describe("runLiveChecks against a running site", () => {
  it("finds what the public can download and which routes answer without a login", async () => {
    const result = await runLiveChecks({
      liveUrl: baseUrl,
      files: repoFiles,
      account: { loginPath: "/api/login", email: "b@test.dev", password: "pw" },
      allowPrivate: true,
      smoke: async () => ({ findings: [], ran: false, pages: [] }),
    });
    const rules = result.findings.map((f) => f.ruleId);
    expect(rules).toContain("web.no-https");
    expect(rules).toContain("web.live-headers");
    expect(rules).toContain("secrets.exposed-file");
    expect(rules).toContain("secrets.live-bundle");
    expect(rules).toContain("web.live-source-maps");
    expect(rules).toContain("authz.public-data");
    expect(rules).toContain("authz.admin-reachable");
    // The SPA-style HTML answer for /.git/HEAD isn't mistaken for an exposed repository.
    expect(result.findings.some((f) => f.title.includes(".git/HEAD"))).toBe(false);
    expect(result.findings.find((f) => f.ruleId === "secrets.live-bundle")?.description).not.toContain(stripeLive);
    expect(result.coverage).toEqual({ liveSite: "checked", smoke: "unverifiable" });
  });

  it.runIf(browserAvailable)("loads pages in a real browser and reports crashes, overflow and errors", async () => {
    const result = await runLiveChecks({ liveUrl: baseUrl, files: repoFiles, allowPrivate: true });
    const titles = result.findings.map((f) => f.title);
    expect(result.coverage.smoke).toBe("checked");
    expect(titles).toContain("1 page doesn't load on the live site");
    expect(titles).toContain("JavaScript crashes on 1 page");
    expect(titles).toContain("1 page is wider than a phone screen");
  }, 60_000);

  it("refuses private addresses unless explicitly allowed", async () => {
    await expect(runLiveChecks({ liveUrl: baseUrl, files: [] })).rejects.toThrow(/private or reserved/);
  });
});

describe("admin guard recognition", () => {
  it("accepts the app's own admin, role and operator helpers", () => {
    const guarded = [
      'import { isAdminUser } from "@/lib/admin-auth";\nexport async function POST() { if (!(await isAdminUser())) return deny(); }',
      "export async function POST() { const jar = await cookies(); if (!isAdminSession(jar)) return deny(); }",
      "export async function GET(request) { const auth = await requirePlatformRoleOrResponse(request, REVIEWERS); if (auth instanceof Response) return auth; }",
      "export async function POST() { const op = await requireOperator(); if ('error' in op) return deny(); }",
    ];
    for (const content of guarded) expect(checkAuthorization([file("app/api/admin/x/route.ts", content)])).toEqual([]);
    const signedInOnly = "export async function POST() { const user = await getCurrentUser(); if (!user) return deny(); await wipe(); }";
    expect(checkAuthorization([file("app/api/admin/x/route.ts", signedInOnly)]).map((f) => f.ruleId)).toEqual(["authz.admin-unguarded"]);
  });

  it("accepts a shared-secret header check as an admin guard", () => {
    const route = file(
      "app/api/admin/stats/route.ts",
      "async function auth(req) {\n  const secret = req.headers.get('x-admin-secret')\n  const expected = process.env.ADMIN_SECRET\n  return secret === expected\n}\nexport async function GET(req) { if (!(await auth(req))) return; }",
    );
    expect(checkAuthorization([route])).toEqual([]);
  });
});
