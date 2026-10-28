import { describe, expect, it } from "vitest";
import { checkDatabaseRules } from "@/lib/checks/database-rules";
import { checkHardcodedSecrets } from "@/lib/checks/hardcoded-secrets";
import { checkLaunchBasics, detectStack } from "@/lib/checks/launch-basics";
import { checkMoney } from "@/lib/checks/money";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content: string): RepoFile => ({ path, content });
const pkg = (deps: Record<string, string>) => file("package.json", JSON.stringify({ name: "app", dependencies: deps }));

// Built at runtime so no realistic-looking secret appears in this file's source.
const stripeLive = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc".repeat(1)].join("_");
const serviceRoleJwt = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from('{"iss":"supabase","role":"service_role"}').toString("base64url"),
  "c2lnbmF0dXJlLWJ5dGVzLWhlcmU",
].join(".");
const anonJwt = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from('{"iss":"supabase","role":"anon"}').toString("base64url"),
  "c2lnbmF0dXJlLWJ5dGVzLWhlcmU",
].join(".");

describe("checkHardcodedSecrets", () => {
  it("flags live keys and service-role JWTs in code, masked, with rotation advice", () => {
    const findings = checkHardcodedSecrets([
      file("lib/stripe.ts", `export const stripe = new Stripe("${stripeLive}");`),
      file("lib/admin.ts", `createClient(url, "${serviceRoleJwt}")`),
    ]);
    expect(findings.map((f) => f.title)).toEqual(["Stripe live secret key committed in code", "Supabase service-role key committed in code"]);
    expect(findings[0].severity).toBe("CRITICAL");
    expect(findings[0].description).not.toContain(stripeLive);
    expect(findings[0].recommendation).toContain("Rotate it now");
  });

  it("ignores public-by-design keys, placeholders and local databases", () => {
    expect(
      checkHardcodedSecrets([
        file("lib/supabase.ts", `createClient(url, "${anonJwt}")`),
        file("lib/firebase.ts", 'const cfg = { apiKey: "AIzaSyD-not-a-secret-by-design-0123456789" };'),
        file("lib/stripe-client.ts", 'loadStripe("pk_live_publishable_key_is_fine_123456")'),
        file("drizzle.config.ts", 'url: "postgres://postgres:postgres@localhost:5432/app"'),
        file("docs/setup.ts", 'url: "postgresql://user:password@db.example.com/app"'),
      ]),
    ).toEqual([]);
  });

  it("flags a real database password in a connection string", () => {
    const url = ["postgresql://app", "Xk82mQpz7Lw@ep-cool-name.neon.tech/app"].join(":");
    const [finding] = checkHardcodedSecrets([file("lib/db.ts", `const url = "${url}";`)]);
    expect(finding.title).toBe("Database password committed in code");
  });

  it("ignores placeholder passwords, sed patterns, and a PEM header with no key", () => {
    const pem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const keyBody = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7".repeat(2);
    const quiet = [
      'DATABASE_URL="postgres://identifier:key@db.prisma.io:5432/postgres"',
      "DB_PASS=$(echo \"$DB_URL\" | sed -E 's|mysql://[^:]+:([^@]*)@.*|\\1|')",
      'const url = `postgres://${user}:${pass}@${host}/db`;',
      `if (pem.startsWith("${pem}")) parsePkcs8(pem);`,
    ];
    for (const content of quiet) expect(checkHardcodedSecrets([file("lib/x.ts", content)])).toEqual([]);
    const [key] = checkHardcodedSecrets([file("lib/sign.ts", `const k = "${pem}\\n${keyBody}\\n-----END PRIVATE KEY-----";`)]);
    expect(key.title).toBe("Private key committed in code");
  });

  it("flags a committed .env file but not .env.example", () => {
    const findings = checkHardcodedSecrets([file(".env", "DATABASE_URL=postgres://x\nNEXT_PUBLIC_URL=https://a.b\n"), file(".env.example", "DATABASE_URL=\n")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ title: ".env is committed to the repository", severity: "CRITICAL" });
    expect(findings[0].recommendation).toContain("git rm --cached .env");
  });
});

describe("checkDatabaseRules", () => {
  it("ignores old Supabase migrations in an app that no longer uses the Supabase client", () => {
    const migrated = checkDatabaseRules([
      pkg({ "@neondatabase/serverless": "^1" }),
      file("supabase/migrations/003_neon_migration.sql", "create table orders (id uuid);\nalter table products disable row level security;"),
    ]);
    expect(migrated).toEqual({ findings: [], coverage: "not-applicable" });
  });

  it("flags Supabase tables created without row level security", () => {
    const result = checkDatabaseRules([
      pkg({ "@supabase/supabase-js": "^2" }),
      file(
        "supabase/migrations/001_init.sql",
        "create table public.profiles (id uuid primary key);\ncreate table if not exists notes (id uuid);\ncreate table private.audit (id int);\nalter table public.profiles enable row level security;",
      ),
    ]);
    expect(result.coverage).toBe("checked");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("1 Supabase table has no row level security");
    expect(result.findings[0].description).toContain("`notes`");
    expect(result.findings[0].description).not.toContain("`audit`");
  });

  it("can't vouch for Supabase when no migrations are committed", () => {
    expect(checkDatabaseRules([pkg({ "@supabase/supabase-js": "^2" })])).toEqual({ findings: [], coverage: "unverifiable" });
    expect(checkDatabaseRules([pkg({ next: "16" })]).coverage).toBe("not-applicable");
  });

  it("flags Firebase rules in test mode or open to everyone", () => {
    const result = checkDatabaseRules([
      pkg({ firebase: "^11" }),
      file("firestore.rules", "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.time < timestamp.date(2026, 1, 1);\n    }\n  }\n}"),
      file("database.rules.json", '{ "rules": { ".read": true, ".write": "auth != null" } }'),
    ]);
    expect(result.findings.map((f) => f.ruleId)).toEqual(["db.firebase-open", "db.firebase-open"]);
    expect(result.findings[0].description).toContain("test mode");
  });

  it("flags the service-role key in a client component", () => {
    const result = checkDatabaseRules([
      pkg({ "@supabase/supabase-js": "^2" }),
      file("components/admin.tsx", '"use client";\nconst s = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);'),
    ]);
    expect(result.findings.map((f) => f.ruleId)).toContain("db.service-role-client");
  });
});

describe("checkMoney", () => {
  it("flags a Stripe webhook that never verifies the signature, and accepts one that does", () => {
    const unverified = checkMoney([
      file("app/api/stripe/webhook/route.ts", "import Stripe from 'stripe';\nexport async function POST(req) {\n  const event = await req.json();\n  if (event.type === 'checkout.session.completed') {}\n}"),
    ]);
    expect(unverified.map((f) => f.ruleId)).toEqual(["money.webhook-unverified"]);
    expect(
      checkMoney([
        file("app/api/stripe/webhook/route.ts", "import Stripe from 'stripe';\nexport async function POST(req) {\n  const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);\n  if (event.type === 'checkout.session.completed') {}\n}"),
      ]),
    ).toEqual([]);
  });

  it("accepts verification done by the app's own helper", () => {
    const route = (verify: string) =>
      checkMoney([file("app/api/stripe/webhook/route.ts", `import Stripe from 'stripe';\nexport async function POST(req) {\n  const sig = req.headers.get('stripe-signature');\n  ${verify}\n  if (event.type === 'checkout.session.completed') {}\n}`)]);
    expect(route("const event = await constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);")).toEqual([]);
    expect(route("if (!(await verifyStripeSignature(body, sig, secret))) return bad(); const event = JSON.parse(body);")).toEqual([]);
    expect(route("const verified = verifyStripeWebhook(payload, sig); const event = verified.event;")).toEqual([]);
    expect(route("const event = JSON.parse(await req.text());").map((f) => f.ruleId)).toEqual(["money.webhook-unverified"]);
  });

  it("flags a checkout that takes the amount from the request body", () => {
    const [finding] = checkMoney([
      file("app/api/checkout/route.ts", "export async function POST(req) {\n  const body = await req.json();\n  await stripe.checkout.sessions.create({ line_items: [{ price_data: { unit_amount: body.amount } }] });\n}"),
    ]);
    expect(finding).toMatchObject({ ruleId: "money.client-price", severity: "HIGH" });
    expect(finding.confidence).toBeLessThan(0.8);
  });

  it("separates AI routes with no login from logged-in routes with no rate limit", () => {
    const findings = checkMoney([
      file("app/api/open/route.ts", 'import OpenAI from "openai";\nexport async function POST(req) { return Response.json(await new OpenAI().responses.create({})); }'),
      file("app/api/authed/route.ts", 'import Anthropic from "@anthropic-ai/sdk";\nexport async function POST(req) { const session = await auth(); if (!session) return; }'),
      file("app/api/safe/route.ts", 'import OpenAI from "openai";\nexport async function POST(req) { const s = await auth(); await ratelimit.limit(s.user.id); }'),
    ]);
    expect(findings.map((f) => [f.ruleId, f.filePath])).toEqual([
      ["money.ai-route-no-auth", "app/api/open/route.ts"],
      ["money.ai-route-no-ratelimit", "app/api/authed/route.ts"],
    ]);
  });

  it("trusts middleware that guards API routes", () => {
    const findings = checkMoney([
      file("middleware.ts", 'export default auth((req) => {});\nexport const config = { matcher: ["/api/:path*"] };\nconst limiter = rateLimit();'),
      file("app/api/gen/route.ts", 'import OpenAI from "openai";\nexport async function POST() {}'),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("checkLaunchBasics", () => {
  it("flags missing error monitoring, public source maps, missing headers and privacy policy", () => {
    const { findings, facts } = checkLaunchBasics([
      pkg({ next: "16", stripe: "^18", resend: "^4" }),
      file("next.config.ts", "export default { productionBrowserSourceMaps: true };"),
    ]);
    expect(findings.map((f) => f.ruleId)).toEqual(["ops.no-error-monitoring", "web.source-maps", "web.security-headers", "legal.no-privacy-policy"]);
    expect(facts).toMatchObject({ framework: "next", emailProvider: "Resend", takesPayments: true, collectsUserData: true });
  });

  it("passes an app with monitoring, headers and a privacy page", () => {
    const { findings } = checkLaunchBasics([
      pkg({ next: "16", "@sentry/nextjs": "^10", "next-auth": "5" }),
      file("next.config.ts", 'export default { async headers() { return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }]; } };'),
      file("app/privacy/page.tsx", "export default function Privacy() { return <h1>Privacy Policy</h1>; }"),
    ]);
    expect(findings).toEqual([]);
  });

  it("detects the stack for specific manual steps", () => {
    expect(detectStack([pkg({ "@supabase/supabase-js": "2", vite: "5" }), file("netlify.toml", "")])).toMatchObject({ database: "supabase", host: "netlify", framework: "vite", collectsUserData: true });
  });
});

describe("checkHardcodedSecrets in tests", () => {
  it("skips test files and fixtures but still flags real code", () => {
    const line = `new Stripe("${stripeLive}")`;
    expect(checkHardcodedSecrets([file("lib/stripe.test.ts", line), file("tests/fixtures/keys.ts", line)])).toEqual([]);
    expect(checkHardcodedSecrets([file("lib/stripe.ts", line)])).toHaveLength(1);
  });
});
