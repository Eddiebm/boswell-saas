import path from "node:path";
import { escapeRegExp, stripComments } from "@/lib/checks/source-utils";
import { isSourceFile } from "@/lib/checks/collect-files";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

/**
 * "Installed but not connected": a package is in package.json, so everyone
 * assumes it's doing its job — but nothing ever initialises it.
 */

type Project = { dir: string; packageJsonPath: string; deps: Record<string, string>; scripts: Record<string, string> };

function inDir(dir: string, file: string) {
  return dir === "" || file.startsWith(`${dir}/`);
}

function exists(files: RepoFile[], dir: string, names: string[]) {
  const wanted = new Set(names.map((n) => (dir ? `${dir}/${n}` : n)));
  return files.find((f) => wanted.has(f.path));
}

function importsPackage(content: string, pkg: string) {
  return new RegExp(`["'\`]${escapeRegExp(pkg)}(?:/[^"'\`]*)?["'\`]`).test(content);
}

type Rule = {
  pkg: string;
  ruleId: string;
  check: (ctx: { files: RepoFile[]; sources: RepoFile[]; dir: string }) => Omit<CheckFinding, "ruleId" | "category" | "confidence"> | null;
};

const INSTRUMENTATION = ["instrumentation.ts", "instrumentation.js", "src/instrumentation.ts", "src/instrumentation.js"];
const CLIENT_INSTRUMENTATION = [
  "instrumentation-client.ts", "instrumentation-client.js", "src/instrumentation-client.ts", "src/instrumentation-client.js",
  "sentry.client.config.ts", "sentry.client.config.js",
];

const RULES: Rule[] = [
  {
    pkg: "@sentry/nextjs",
    ruleId: "integrations.error-monitoring",
    check: ({ files, dir }) => {
      const server = exists(files, dir, INSTRUMENTATION);
      const serverWired = server && /sentry/i.test(stripComments(server.content));
      const client = exists(files, dir, CLIENT_INSTRUMENTATION);
      const clientWired = client && /sentry/i.test(stripComments(client.content));
      if (serverWired && clientWired) return null;
      const orphanConfig = exists(files, dir, ["sentry.server.config.ts", "sentry.server.config.js"]);
      const gaps = [
        !serverWired &&
          (orphanConfig
            ? `\`${orphanConfig.path}\` exists, but there's no \`instrumentation.ts\` that loads it — Next.js never runs it, so server-side errors (API routes, server components, server actions) are not reported.`
            : "There's no `instrumentation.ts` registering Sentry, so server-side errors (API routes, server components, server actions) are not reported."),
        !clientWired && "There's no `instrumentation-client.ts` (or `sentry.client.config`), so browser errors are not reported either.",
      ].filter(Boolean);
      return {
        severity: serverWired ? "LOW" : "MEDIUM",
        title: "Sentry is installed but not connected",
        description: `\`@sentry/nextjs\` is a dependency, so it looks like errors are being monitored. They aren't all:\n\n${gaps.map((g) => `- ${g}`).join("\n")}\n\nProduction failures will go unnoticed until a user reports them.`,
        filePath: path.posix.join(dir, "package.json"),
        recommendation: "Run `npx @sentry/wizard@latest -i nextjs`, or add `instrumentation.ts` with a `register()` that imports your Sentry server config, then trigger a test error and confirm it appears in Sentry.",
      };
    },
  },
  ...["@sentry/node", "@sentry/react", "@sentry/browser", "@sentry/remix", "@sentry/sveltekit"].map((pkg): Rule => ({
    pkg,
    ruleId: "integrations.error-monitoring",
    check: ({ sources }) =>
      sources.some((f) => importsPackage(f.content, pkg) && /\binit\s*\(/.test(f.content))
        ? null
        : {
            severity: "MEDIUM",
            title: "Sentry is installed but never initialised",
            description: `\`${pkg}\` is a dependency, but no file calls \`Sentry.init()\`. Errors are not being reported anywhere.`,
            recommendation: `Call \`Sentry.init({ dsn: process.env.SENTRY_DSN })\` at your app's entry point, then trigger a test error and confirm it arrives.`,
          },
  })),
  {
    pkg: "@vercel/analytics",
    ruleId: "integrations.analytics",
    check: ({ sources }) =>
      sources.some((f) => importsPackage(f.content, "@vercel/analytics") && /<Analytics\b|\binject\s*\(|\btrack\s*\(/.test(f.content))
        ? null
        : {
            severity: "LOW",
            title: "Vercel Analytics is installed but not rendered",
            description: "`@vercel/analytics` is a dependency, but `<Analytics />` isn't rendered anywhere, so no page views are being recorded.",
            recommendation: "Render `<Analytics />` from `@vercel/analytics/next` in your root layout.",
          },
  },
  {
    pkg: "@vercel/speed-insights",
    ruleId: "integrations.analytics",
    check: ({ sources }) =>
      sources.some((f) => importsPackage(f.content, "@vercel/speed-insights") && /<SpeedInsights\b|\binjectSpeedInsights\s*\(/.test(f.content))
        ? null
        : {
            severity: "LOW",
            title: "Speed Insights is installed but not rendered",
            description: "`@vercel/speed-insights` is a dependency, but `<SpeedInsights />` isn't rendered anywhere, so no performance data is being collected.",
            recommendation: "Render `<SpeedInsights />` from `@vercel/speed-insights/next` in your root layout.",
          },
  },
  {
    pkg: "@upstash/ratelimit",
    ruleId: "integrations.ratelimit-unused",
    check: ({ sources }) =>
      sources.some((f) => importsPackage(f.content, "@upstash/ratelimit") && /\.limit\s*\(/.test(f.content))
        ? null
        : {
            severity: "MEDIUM",
            title: "Rate limiting is installed but never applied",
            description: "`@upstash/ratelimit` is a dependency, but nothing calls `.limit()`, so no request is actually rate limited. Login, signup and paid-API routes are open to brute force and cost abuse.",
            recommendation: "Call `ratelimit.limit(identifier)` at the top of sensitive route handlers (or in middleware) and reject when `success` is false.",
          },
  },
  ...["posthog-js", "posthog-node"].map((pkg): Rule => ({
    pkg,
    ruleId: "integrations.analytics",
    check: ({ sources }) =>
      sources.some((f) => importsPackage(f.content, pkg) && /posthog\.init\s*\(|new PostHog\s*\(|PostHogProvider/.test(f.content))
        ? null
        : {
            severity: "LOW",
            title: "PostHog is installed but never initialised",
            description: `\`${pkg}\` is a dependency, but no file initialises it, so no product analytics are being captured.`,
            recommendation: pkg === "posthog-js" ? "Call `posthog.init()` in a client provider mounted from your root layout." : "Create a `new PostHog(key)` client where you capture server events.",
          },
  })),
];

/**
 * Packages that are legitimately never imported by name: CLIs, build
 * plugins, type packages, and framework peers picked up by convention.
 */
const NEVER_IMPORTED_OK = [
  /^@types\//, /^eslint/, /^@eslint\//, /^prettier/, /^typescript$/, /^tailwindcss$/, /^@tailwindcss\//, /^postcss/, /^autoprefixer$/,
  /^react-dom$/, /^next$/, /^sharp$/, /^drizzle-kit$/, /^prisma$/, /^@prisma\/client$/, /^tsx$/, /^ts-node$/, /^nodemon$/,
  /^concurrently$/, /^husky$/, /^lint-staged$/, /^vitest$/, /^@vitest\//, /^jest/, /^@playwright\//, /^playwright$/, /^server-only$/,
  /^client-only$/, /^pg$/, /^@babel\//, /^babel-/, /^webpack/, /^vite$/, /^@vitejs\//, /^turbo$/, /^dotenv-cli$/, /^cross-env$/,
];

export function checkIntegrations(files: RepoFile[]): CheckFinding[] {
  const projects: Project[] = [];
  for (const f of files) {
    if (path.posix.basename(f.path) !== "package.json" || f.path.includes("node_modules/")) continue;
    try {
      const pkg = JSON.parse(f.content) as { dependencies?: Record<string, string>; scripts?: Record<string, string> };
      projects.push({ dir: path.posix.dirname(f.path) === "." ? "" : path.posix.dirname(f.path), packageJsonPath: f.path, deps: pkg.dependencies ?? {}, scripts: pkg.scripts ?? {} });
    } catch {
      /* invalid package.json — the drift check reports it */
    }
  }

  const out: CheckFinding[] = [];
  for (const project of projects) {
    const scoped = files.filter((f) => inDir(project.dir, f.path));
    const sources = scoped.filter((f) => isSourceFile(f) || f.path.endsWith(".css")).map((f) => ({ ...f, content: stripComments(f.content) }));
    const reported = new Set<string>();

    for (const rule of RULES) {
      if (!(rule.pkg in project.deps)) continue;
      reported.add(rule.pkg);
      const result = rule.check({ files: scoped, sources, dir: project.dir });
      if (!result) continue;
      out.push({ ruleId: rule.ruleId, filePath: project.packageJsonPath, ...result, category: "integrations", confidence: 0.85 });
    }

    const scripts = Object.values(project.scripts).join(" ");
    const unused = Object.keys(project.deps).filter(
      (name) =>
        !reported.has(name) &&
        !NEVER_IMPORTED_OK.some((re) => re.test(name)) &&
        !scripts.includes(name) &&
        !sources.some((f) => importsPackage(f.content, name)),
    );
    if (unused.length) {
      out.push({
        ruleId: "integrations.unused-deps",
        severity: "INFO",
        category: "integrations",
        title: `${unused.length} ${unused.length === 1 ? "dependency is" : "dependencies are"} installed but never used`,
        description: [
          `Nothing in ${project.dir ? `\`${project.dir}\`` : "the project"} imports ${unused.length === 1 ? "this production dependency" : "these production dependencies"}. Either a feature was removed and the package left behind (dead weight, and still a vulnerability surface), or something you meant to wire up never was:`,
          "",
          ...unused.slice(0, 15).map((n) => `- \`${n}\``),
          ...(unused.length > 15 ? [`- …and ${unused.length - 15} more`] : []),
        ].join("\n"),
        filePath: project.packageJsonPath,
        recommendation: "For each one, either finish wiring it up or `npm uninstall` it. Needs review: packages loaded by a config file or plugin convention can look unused.",
        confidence: 0.6,
      });
    }
  }
  return out;
}
