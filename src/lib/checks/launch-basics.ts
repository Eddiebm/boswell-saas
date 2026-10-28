import path from "node:path";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

/** What Boswell could tell about the stack — used to make Ship Ready's manual steps specific. */
export type StackFacts = {
  framework: "next" | "vite" | "remix" | "astro" | "sveltekit" | "other";
  host: "vercel" | "netlify" | "render" | "fly" | "cloudflare" | "railway" | "unknown";
  database: "supabase" | "firebase" | "neon" | "planetscale" | "mongodb" | "postgres" | "none" | "unknown";
  emailProvider: string | null;
  takesPayments: boolean;
  collectsUserData: boolean;
};

const ERROR_MONITORING = /"(?:@sentry\/[\w-]+|@bugsnag\/[\w-]+|@honeybadger-io\/[\w-]+|rollbar|@highlight-run\/[\w-]+|@datadog\/browser-(?:rum|logs)|logrocket|newrelic|@logtail\/[\w-]+|@axiomhq\/[\w-]+|posthog-js|@vercel\/otel)"\s*:/;

function allDeps(files: RepoFile[]): string {
  return files.filter((f) => path.posix.basename(f.path) === "package.json" && !f.path.includes("node_modules/")).map((f) => f.content).join("\n");
}

export function detectStack(files: RepoFile[]): StackFacts {
  const deps = allDeps(files);
  const has = (re: RegExp) => re.test(deps);
  const exists = (re: RegExp) => files.some((f) => re.test(f.path));
  const emailProvider = has(/"resend"\s*:/) ? "Resend" : has(/"@sendgrid\/mail"\s*:/) ? "SendGrid" : has(/"postmark"\s*:/) ? "Postmark" : has(/"nodemailer"\s*:/) ? "SMTP (nodemailer)" : has(/"mailgun(?:\.js)?"\s*:/) ? "Mailgun" : has(/"@aws-sdk\/client-ses"\s*:/) ? "Amazon SES" : null;
  return {
    framework: has(/"next"\s*:/) ? "next" : has(/"@remix-run\/[\w-]+"\s*:/) ? "remix" : has(/"astro"\s*:/) ? "astro" : has(/"@sveltejs\/kit"\s*:/) ? "sveltekit" : has(/"vite"\s*:/) ? "vite" : "other",
    host: exists(/(^|\/)vercel\.json$/) || has(/"@vercel\//) ? "vercel" : exists(/(^|\/)netlify\.toml$/) ? "netlify" : exists(/(^|\/)render\.ya?ml$/) ? "render" : exists(/(^|\/)fly\.toml$/) ? "fly" : exists(/(^|\/)wrangler\.(?:toml|jsonc?)$/) ? "cloudflare" : exists(/(^|\/)railway\.(?:json|toml)$/) ? "railway" : "unknown",
    database: has(/"@supabase\//) ? "supabase" : has(/"firebase(?:-admin)?"\s*:/) ? "firebase" : has(/"@neondatabase\/serverless"\s*:/) ? "neon" : has(/"@planetscale\/database"\s*:/) ? "planetscale" : has(/"(?:mongodb|mongoose)"\s*:/) ? "mongodb" : has(/"(?:pg|postgres|@vercel\/postgres)"\s*:/) ? "postgres" : has(/"(?:drizzle-orm|@prisma\/client|kysely|typeorm|sequelize)"\s*:/) ? "unknown" : "none",
    emailProvider,
    takesPayments: has(/"(?:stripe|@stripe\/stripe-js|@lemonsqueezy\/[\w-]+|@paddle\/[\w-]+)"\s*:/),
    collectsUserData: has(/"(?:next-auth|@auth\/[\w-]+|@clerk\/[\w-]+|@supabase\/[\w-]+|firebase|better-auth|lucia|@kinde-oss\/[\w-]+|stripe)"\s*:/) || emailProvider !== null,
  };
}

/**
 * Basics a launched app is expected to have, checkable from the repo:
 * error monitoring, no public source maps, security headers, and a privacy
 * policy when it collects personal data.
 */
export function checkLaunchBasics(files: RepoFile[]): { findings: CheckFinding[]; facts: StackFacts } {
  const out: CheckFinding[] = [];
  const facts = detectStack(files);
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return { findings: out, facts };

  if (!ERROR_MONITORING.test(allDeps(files))) {
    out.push({
      ruleId: "ops.no-error-monitoring",
      severity: "MEDIUM",
      category: "operations",
      title: "No error monitoring",
      description: "Nothing in this app reports errors anywhere. When something breaks for a user after launch — a failed payment, a crashing page — you won't know until they tell you, and most won't.",
      filePath: "package.json",
      recommendation: facts.framework === "next" ? "Add Sentry (`npx @sentry/wizard@latest -i nextjs`), deploy, and trigger a test error to confirm it arrives." : "Add an error monitoring service (Sentry has a free tier), deploy, and trigger a test error to confirm it arrives.",
      confidence: 0.85,
    });
  }

  const configs = files.filter((f) => /(^|\/)(?:next|vite)\.config\.[cm]?[jt]s$/.test(f.path));
  for (const f of configs) {
    const m = /productionBrowserSourceMaps\s*:\s*true|\bsourcemap\s*:\s*true/.exec(f.content);
    if (!m) continue;
    out.push({
      ruleId: "web.source-maps",
      severity: "MEDIUM",
      category: "security",
      title: "Production source maps are public",
      description: `\`${f.path}\` publishes source maps in production, so anyone can read your original front-end source — comments, internal URLs and logic included — in their browser's dev tools.`,
      filePath: f.path,
      lineStart: lineOf(f.content, m.index),
      recommendation: "Turn public source maps off. If you need them for error monitoring, upload them to the monitoring service privately (Sentry does this) instead of serving them.",
      confidence: 0.9,
    });
  }

  if (facts.framework === "next") {
    const headerSources = files.filter((f) => /(^|\/)(?:next\.config\.[cm]?[jt]s|vercel\.json|netlify\.toml|(?:src\/)?(?:middleware|proxy)\.[jt]s)$/.test(f.path) || /(^|\/)_headers$/.test(f.path));
    const setsHeaders = headerSources.some((f) => /Strict-Transport-Security|X-Frame-Options|Content-Security-Policy|frame-ancestors|X-Content-Type-Options/i.test(f.content));
    if (!setsHeaders) {
      out.push({
        ruleId: "web.security-headers",
        severity: "LOW",
        category: "security",
        title: "No security headers configured",
        description: "The app doesn't set the standard browser security headers, so other sites can embed it in a frame (clickjacking) and browsers get no extra protection against injected scripts.",
        filePath: configs[0]?.path ?? "package.json",
        recommendation: "Add `headers()` to next.config with at least `X-Frame-Options: DENY` (or a CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Strict-Transport-Security`.",
        confidence: 0.75,
      });
    }
  }

  if (facts.collectsUserData) {
    const hasPolicy = files.some(
      (f) => /(^|\/)(?:privacy|privacy-policy)(?:\/page)?\.(?:[jt]sx?|mdx?|html)$|(^|\/)(?:privacy|privacy-policy)\/page\.[jt]sx?$/i.test(f.path) || (/\.(?:[jt]sx|mdx?|html)$/.test(f.path) && /privacy policy/i.test(f.content) && /\b(?:collect|personal (?:data|information)|cookies)\b/i.test(f.content)),
    );
    if (!hasPolicy) {
      out.push({
        ruleId: "legal.no-privacy-policy",
        severity: "LOW",
        category: "legal",
        title: "No privacy policy",
        description: `This app ${facts.takesPayments ? "takes payments and " : ""}collects personal data (accounts or email addresses) but has no privacy policy page. Payment providers, app stores and privacy laws (GDPR, CCPA) expect one, and Stripe can pause payouts without it.`,
        filePath: "package.json",
        recommendation: "Add a /privacy page saying what you collect, why, which services process it (hosting, database, email, payments, analytics), how long you keep it, and how users can ask for deletion. Link it in the footer and on sign-up.",
        confidence: 0.75,
      });
    }
  }

  return { findings: out, facts };
}
