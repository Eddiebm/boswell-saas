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
  /** Analytics or ad scripts that set cookies — EU visitors must consent first. (Absent on audits saved before it existed.) */
  setsTrackingCookies?: boolean;
  /** Schema names that point at medical records — HIPAA territory in the US. (Absent on older audits.) */
  handlesHealthData?: boolean;
};

const ERROR_MONITORING = /"(?:@sentry\/[\w-]+|@bugsnag\/[\w-]+|@honeybadger-io\/[\w-]+|rollbar|@highlight-run\/[\w-]+|@datadog\/browser-(?:rum|logs)|logrocket|newrelic|@logtail\/[\w-]+|@axiomhq\/[\w-]+|posthog-js|@vercel\/otel)"\s*:/;

function allDeps(files: RepoFile[]): string {
  return files.filter((f) => path.posix.basename(f.path) === "package.json" && !f.path.includes("node_modules/")).map((f) => f.content).join("\n");
}

const TRACKING_DEPS = /"(?:react-ga4?|posthog-js|mixpanel-browser|@segment\/analytics-next|@amplitude\/analytics-browser|@hotjar\/browser|react-facebook-pixel|@intercom\/messenger-js-sdk)"\s*:/;
const TRACKING_CODE = /googletagmanager\.com|\bgtag\s*\(|<GoogleAnalytics\b|<GoogleTagManager\b|connect\.facebook\.net|\bfbq\s*\(|static\.hotjar\.com|clarity\.ms/;
const CONSENT = /cookie-?consent|cookiehub|klaro|cookiebot|osano|termly|iubenda|consent-?manager|gtag\s*\(\s*["']consent["']/i;
const HEALTH_NAMES = /\b(?:patients?|diagnos[ei]s|prescriptions?|medical_records?|medications?|symptoms?|clinical_notes?|lab_results?|health_records?|ehr|phi|treatment_plans?)\b/gi;

function hasPage(files: RepoFile[], slugs: string, heading: RegExp) {
  const pathRe = new RegExp(`(^|/)(?:${slugs})(?:/page)?\\.(?:[jt]sx?|mdx?|html)$`, "i");
  return files.some((f) => pathRe.test(f.path) || (/\.(?:[jt]sx|mdx?|html)$/.test(f.path) && heading.test(f.content)));
}

/** Distinct health-record terms used as table, model or column names (not in prose). */
function healthTerms(files: RepoFile[]): Set<string> {
  const terms = new Set<string>();
  for (const f of files) {
    if (!/\.(?:sql|prisma)$|(^|\/)(?:schema|models?)\b[^/]*\.[jt]s$/.test(f.path)) continue;
    for (const m of f.content.matchAll(HEALTH_NAMES)) terms.add(m[0].toLowerCase().replace(/s$/, ""));
  }
  return terms;
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
    setsTrackingCookies: TRACKING_DEPS.test(deps) || files.some((f) => /\.(?:[jt]sx?|html)$/.test(f.path) && TRACKING_CODE.test(f.content)),
    handlesHealthData: healthTerms(files).size >= 2,
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

  if (facts.takesPayments && !hasPage(files, "terms|terms-of-service|tos|terms-and-conditions", /terms (?:of service|and conditions|of use)/i)) {
    out.push({
      ruleId: "legal.no-terms",
      severity: "LOW",
      category: "legal",
      title: "No terms of service or refund policy",
      description: "This app takes payments but has no terms page. Stripe expects your site to show terms and a refund/cancellation policy, and without them you have nothing to point to when a customer disputes a charge.",
      filePath: "package.json",
      recommendation: "Add a /terms page covering what customers get, billing and renewal, cancellation and refunds, and acceptable use. Link it in the footer and next to the checkout button.",
      confidence: 0.75,
    });
  }

  if (facts.setsTrackingCookies && !files.some((f) => (f.path.endsWith("package.json") || /\.(?:[jt]sx?|html)$/.test(f.path)) && CONSENT.test(f.content))) {
    out.push({
      ruleId: "legal.no-cookie-consent",
      severity: "LOW",
      category: "legal",
      title: "Tracking cookies without a consent banner",
      description: "The app loads analytics or ad scripts that set cookies (Google Analytics, Meta pixel, PostHog, Hotjar, …) and there's no consent mechanism. In the EU and UK, these cookies need consent before they're set.\n\nNeeds review: if you only have US visitors, or your analytics run cookieless, this may not apply.",
      filePath: "package.json",
      recommendation: "Add a consent banner that blocks tracking until the visitor agrees (e.g. vanilla-cookieconsent, or your analytics tool's built-in consent mode), or switch to cookieless analytics such as Vercel Analytics or Plausible.",
      confidence: 0.6,
    });
  }

  if (facts.handlesHealthData) {
    out.push({
      ruleId: "compliance.health-data",
      severity: "HIGH",
      category: "compliance",
      title: "The app stores health data",
      description: `The database schema includes health-record fields (${[...healthTerms(files)].slice(0, 5).join(", ")}). In the US, health data handled for or by healthcare providers is protected by HIPAA, and storing it with vendors who haven't signed a Business Associate Agreement (BAA) is a violation in itself.\n\nNeeds review: wellness apps used directly by consumers are often outside HIPAA, but other health-privacy laws (e.g. Washington's My Health My Data Act) still apply.`,
      filePath: "package.json",
      recommendation: "Decide with a lawyer whether HIPAA applies. If it does: sign BAAs with every vendor that touches the data (hosting, database, email, AI providers — many free tiers can't sign one), encrypt it at rest, log access to it, and keep it out of analytics and error reports.",
      confidence: 0.6,
    });
  }

  return { findings: out, facts };
}
