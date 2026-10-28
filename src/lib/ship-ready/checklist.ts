import type { ChecksSummary, Coverage } from "@/lib/checks";
import type { StackFacts } from "@/lib/checks/launch-basics";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ShipFinding = {
  id: string;
  ruleId: string | null;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  filePath?: string | null;
  lineStart?: number | null;
  recommendation?: string | null;
  confidence: number;
};

export type LiveVerifyState = "leak" | "no-leak" | "not-set-up";

export type ItemStatus = "fail" | "review" | "pass" | "unverified" | "n/a";
export type FixKind = "auto" | "prompt" | "steps";

export type ShipReadyItem = {
  id: string;
  area: string;
  title: string;
  why: string;
  status: ItemStatus;
  /** Findings that decide the status, most severe first. */
  findings: ShipFinding[];
  fix: FixKind;
  /** Plain-English steps for things Boswell can't see from the code. */
  steps: string[];
  /** Copy-paste prompt for the user's AI coding tool, when code needs changing. */
  prompt: string | null;
};

export type ShipReadyVerdict = {
  state: "ready" | "almost" | "not-ready" | "unknown";
  headline: string;
  blockers: number;
  toReview: number;
  toConfirm: number;
  passed: number;
  items: ShipReadyItem[];
  /** One prompt covering every blocker and review item. */
  fixAllPrompt: string | null;
};

const RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
/** Below this, a finding is a pattern match a person should confirm, not proof. */
const PROOF = 0.8;

type Ctx = { summary: ChecksSummary | null; facts: StackFacts | null; live: LiveVerifyState };

type ItemDef = {
  id: string;
  area: string;
  title: string;
  why: string;
  rules: string[];
  /** Engine findings (no rule id) in these categories also count. */
  categories?: string[];
  /** Lowest severity that blocks launch (when the finding is proven). */
  blockAt: Severity;
  /** Lowest severity worth a look before launch; defaults to blockAt. */
  reviewAt?: Severity;
  /** Rules that block launch whatever their severity (e.g. a lockfile that breaks every install). */
  alwaysBlock?: string[];
  coverage: (ctx: Ctx) => Coverage;
  fix: FixKind;
  steps?: (ctx: Ctx) => string[];
};

const RULED = new Set<string>();

const ITEMS: ItemDef[] = [
  {
    id: "data-isolation",
    area: "Data",
    title: "Users can't see each other's data",
    why: "The most damaging bug a new app can have: one customer opens another customer's records.",
    rules: ["secrets.row-exposure", "authz.public-data", "authz.admin-reachable", "authz.mass-assignment", "authz.admin-unguarded"],
    blockAt: "HIGH",
    reviewAt: "MEDIUM",
    coverage: (ctx) => (ctx.live === "not-set-up" ? "unverifiable" : "checked"),
    fix: "prompt",
    steps: () => [
      "Open Live verification in Boswell and add your staging URL with two test accounts.",
      "Boswell signs in as both and proves whether account B can read account A's data.",
    ],
  },
  {
    id: "database-rules",
    area: "Data",
    title: "The database rejects strangers",
    why: "Supabase and Firebase keys are public. Without row level security or proper rules, anyone can read or wipe your tables from their browser.",
    rules: ["db.rls-disabled", "db.firebase-open", "db.service-role-client"],
    blockAt: "HIGH",
    coverage: (ctx) => ctx.summary?.coverage.databaseRules ?? "unverifiable",
    fix: "prompt",
    steps: (ctx) =>
      ctx.facts?.database === "supabase"
        ? ["In Supabase, open Advisors → Security Advisor and fix every table flagged \"RLS disabled\".", "Commit your schema as migrations so Boswell can check it on every audit."]
        : ["In the Firebase console, open Firestore → Rules and Storage → Rules and make sure no rule says `if true`.", "Commit firestore.rules to the repo so Boswell can check it on every audit."],
  },
  {
    id: "secrets",
    area: "Secrets",
    title: "No secret keys in code or the browser",
    why: "A key in the repo or the front-end bundle can be copied by anyone and used on your bill or your data.",
    rules: ["secrets.hardcoded", "secrets.history", "secrets.public-env", "secrets.live-bundle", "secrets.exposed-file"],
    categories: ["secrets"],
    blockAt: "HIGH",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "payments",
    area: "Money",
    title: "Payments can't be faked",
    why: "If Stripe webhooks aren't verified or prices come from the browser, people can get paid features for free.",
    rules: ["money.webhook-unverified", "money.client-price"],
    blockAt: "HIGH",
    coverage: (ctx) => (!ctx.summary ? "unverifiable" : ctx.facts?.takesPayments ? "checked" : "not-applicable"),
    fix: "prompt",
  },
  {
    id: "ai-costs",
    area: "Money",
    title: "Nobody can run up your AI bill",
    why: "An AI route without a login check or rate limit can be called thousands of times an hour, billed to you.",
    rules: ["money.ai-route-no-auth", "money.ai-route-no-ratelimit", "integrations.ratelimit-unused"],
    blockAt: "MEDIUM",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "dependencies",
    area: "Code",
    title: "No known-vulnerable packages, and clean installs work",
    why: "Published vulnerabilities are the first thing attackers scan for, and a broken lockfile breaks every deploy.",
    rules: ["deps.vulnerable", "deps.lockfile-drift", "deps.lockfile-invalid", "deps.lockfile-missing", "deps.upgrade-blocker"],
    blockAt: "HIGH",
    alwaysBlock: ["deps.lockfile-drift", "deps.lockfile-invalid"],
    coverage: (ctx) => ctx.summary?.coverage.dependencies ?? "unverifiable",
    fix: "auto",
    steps: () => [
      "Boswell couldn't audit every dependency file in this repo (it reads package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, requirements.txt, poetry.lock, Pipfile.lock and Gemfile.lock).",
      "Run your package manager's audit locally (`npm audit`, `pnpm audit`, `pip-audit`, `bundle audit`) and fix anything critical or high.",
    ],
  },
  {
    id: "code-review",
    area: "Code",
    title: "No critical issues in the code review",
    why: "Boswell's full audit of the codebase found nothing it rates critical or high.",
    rules: [],
    categories: ["*"],
    // The engine's ratings are a model's judgement: critical blocks, high asks for a look.
    blockAt: "CRITICAL",
    reviewAt: "HIGH",
    coverage: () => "checked",
    fix: "prompt",
  },
  {
    id: "server-safety",
    area: "Code",
    title: "Server code can't be turned against you",
    why: "Routes that fetch any URL they're given, refreshes that delete other features' data, and calls that hang forever.",
    rules: ["security.ssrf", "data.refresh-wipe", "reliability.no-timeout"],
    blockAt: "MEDIUM",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "live-site",
    area: "Operations",
    title: "The live site works",
    why: "Pages that error, crash in the browser or break on a phone lose visitors before they ever see the product.",
    rules: ["ops.page-broken", "ops.console-errors", "web.mobile-overflow", "ops.slow-page"],
    blockAt: "HIGH",
    reviewAt: "MEDIUM",
    coverage: (ctx) => ctx.summary?.coverage.smoke ?? "unverifiable",
    fix: "prompt",
    steps: () => [
      "Add your live URL on this page — Boswell will then load every page in a real browser (desktop and phone) on each audit.",
      "Until then: open each page on your phone and desktop, and check the browser console for red errors.",
    ],
  },
  {
    id: "config",
    area: "Deploy",
    title: "Every setting the app needs is documented",
    why: "An undocumented environment variable is a production outage waiting for the next deploy or the next host.",
    rules: ["deploy.env-undocumented"],
    blockAt: "HIGH",
    reviewAt: "MEDIUM",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "error-monitoring",
    area: "Operations",
    title: "You'll know when something breaks",
    why: "Without error monitoring, production failures are invisible until a user complains — most just leave.",
    rules: ["ops.no-error-monitoring", "integrations.error-monitoring"],
    blockAt: "MEDIUM",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "web-hardening",
    area: "Web",
    title: "The site is hardened",
    why: "Public source maps hand out your code; missing security headers let other sites frame yours.",
    rules: ["web.source-maps", "web.security-headers", "web.no-https", "web.live-headers", "web.live-source-maps", "web.exposed-file"],
    blockAt: "MEDIUM",
    coverage: (ctx) => (ctx.summary ? "checked" : "unverifiable"),
    fix: "prompt",
  },
  {
    id: "legal",
    area: "Legal",
    title: "The legal basics are in place",
    why: "A privacy policy if you collect personal data, terms and a refund policy if you take payments, and cookie consent if you track EU visitors — payment providers and privacy laws expect them.",
    rules: ["legal.no-privacy-policy", "legal.no-terms", "legal.no-cookie-consent"],
    blockAt: "LOW",
    coverage: (ctx) =>
      !ctx.summary ? "unverifiable" : ctx.facts?.collectsUserData || ctx.facts?.takesPayments || ctx.facts?.setsTrackingCookies ? "checked" : "not-applicable",
    fix: "prompt",
  },
  {
    id: "health-data",
    area: "Legal",
    title: "Health data is handled lawfully",
    why: "Medical data carries its own law (HIPAA in the US): every vendor that touches it needs a signed agreement, and a breach is reportable.",
    rules: ["compliance.health-data"],
    blockAt: "HIGH",
    coverage: (ctx) => (ctx.facts?.handlesHealthData ? "checked" : "not-applicable"),
    fix: "steps",
    steps: () => [
      "Decide with a lawyer whether HIPAA (or a state health-privacy law) applies to your app.",
      "If it does, get a signed Business Associate Agreement from each vendor that stores or processes the data — hosting, database, email, AI and error monitoring.",
      "Keep health data out of analytics, logs and error reports, and turn on access logging in your database.",
    ],
  },
  {
    id: "backups",
    area: "Operations",
    title: "Database backups are on",
    why: "One bad migration or deleted table without a backup is permanent.",
    rules: [],
    blockAt: "HIGH",
    coverage: (ctx) => (ctx.facts?.database === "none" ? "not-applicable" : "unverifiable"),
    fix: "steps",
    steps: (ctx) => {
      switch (ctx.facts?.database) {
        case "supabase":
          return ["Supabase → Database → Backups: confirm daily backups (Pro plan) or enable Point-in-Time Recovery.", "Restore a backup into a test project once, so you know it works."];
        case "neon":
          return ["Neon → your project → Settings: check the history retention window (point-in-time restore).", "Try a branch restore once, so you know it works."];
        case "firebase":
          return ["Google Cloud console → Firestore → Disaster recovery: schedule daily backups."];
        case "planetscale":
          return ["PlanetScale → your database → Backups: confirm the backup schedule."];
        case "mongodb":
          return ["MongoDB Atlas → your cluster → Backup: turn on cloud backups."];
        default:
          return ["Turn on automatic daily backups with your database provider.", "Restore a backup once into a test database, so you know it works."];
      }
    },
  },
  {
    id: "uptime",
    area: "Operations",
    title: "Something tells you when the site goes down",
    why: "If the site is down at 3am, you want an alert — not a customer email at 9.",
    rules: [],
    blockAt: "HIGH",
    coverage: () => "unverifiable",
    fix: "steps",
    steps: (ctx) => [
      "Add a free uptime monitor (UptimeRobot, Better Stack, or a scheduled GitHub Action that pings your URL) checking every 5 minutes.",
      "Point its alerts at your phone or email and test one by pausing the site.",
      ...(ctx.facts?.database === "supabase"
        ? ["Supabase pauses free-tier projects after a week without activity, taking your app down with it. Upgrade before launch, or make sure something uses the database daily."]
        : []),
    ],
  },
  {
    id: "email-dns",
    area: "Email",
    title: "Your emails won't land in spam",
    why: "Without SPF, DKIM and DMARC records, password resets and receipts go to spam or get rejected.",
    rules: [],
    blockAt: "HIGH",
    coverage: (ctx) => (ctx.facts?.emailProvider ? "unverifiable" : "not-applicable"),
    fix: "steps",
    steps: (ctx) => [
      `In ${ctx.facts?.emailProvider ?? "your email provider"}, verify your sending domain and add the DNS records it gives you (SPF and DKIM).`,
      "Add a DMARC record: `_dmarc.yourdomain.com TXT \"v=DMARC1; p=quarantine\"`.",
      "Send a test email to mail-tester.com and aim for 9/10 or better.",
    ],
  },
];
for (const item of ITEMS) for (const rule of item.rules) RULED.add(rule);

function belongsTo(item: ItemDef, f: ShipFinding) {
  if (f.ruleId) return item.rules.includes(f.ruleId);
  if (!item.categories) return false;
  if (item.categories.includes("*")) {
    // The code review item takes engine findings no more specific item claims.
    return !ITEMS.some((other) => other !== item && other.categories?.includes(f.category));
  }
  return item.categories.includes(f.category);
}

function promptFor(repo: string, goal: string, findings: ShipFinding[]): string | null {
  if (!findings.length) return null;
  return [
    `In the ${repo} repository, fix the following so the app is safe to launch (${goal}):`,
    "",
    ...findings.slice(0, 12).flatMap((f, i) => [
      `${i + 1}. ${f.title}${f.filePath ? ` — ${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}` : ""}`,
      ...(f.recommendation ? [`   Fix: ${f.recommendation}`] : []),
    ]),
    "",
    "Make the smallest change that fixes each one, don't change unrelated code, and if a finding turns out to be a false alarm, say why instead of changing it. Rotating leaked keys has to be done by me in the provider's dashboard — tell me which ones.",
  ].join("\n");
}

/**
 * How one finding counts towards launch, using the same item rules as the
 * checklist: "block" (proven and serious enough), "review" (serious but a
 * pattern match), or null (noted only, or not a launch criterion).
 */
export function classifyFinding(f: ShipFinding): { item: string; level: "block" | "review" } | null {
  if (f.ruleId && !RULED.has(f.ruleId)) return null;
  const def = ITEMS.find((d) => belongsTo(d, f));
  if (!def) return null;
  const always = Boolean(f.ruleId && def.alwaysBlock?.includes(f.ruleId));
  if (!always && RANK[f.severity] < RANK[def.reviewAt ?? def.blockAt]) return null;
  const blocks = (always || RANK[f.severity] >= RANK[def.blockAt]) && f.confidence >= PROOF;
  return { item: def.id, level: blocks ? "block" : "review" };
}

const HEADLINE = {
  ready: "Ship Ready",
  almost: "No blockers — confirm the rest before launch",
  "not-ready": "Not ready to ship",
  unknown: "Run an audit to check",
};

/**
 * Turns one audit's findings, what its checks could see, and the latest live
 * verification into a launch checklist and a single verdict. An item only
 * passes when the check behind it actually ran; pattern matches below proof
 * confidence ask for review instead of blocking.
 */
export function evaluateShipReady(input: {
  repo: string;
  findings: ShipFinding[];
  summary: ChecksSummary | null;
  live: LiveVerifyState;
  /** What the latest live verification run said, shown when it found a leak. */
  liveSummary?: string | null;
  auditCompleted: boolean;
}): ShipReadyVerdict {
  const ctx: Ctx = { summary: input.summary, facts: input.summary?.facts ?? null, live: input.live };
  const open = input.findings.filter((f) => !f.ruleId || RULED.has(f.ruleId));
  if (input.live === "leak") {
    open.push({
      id: "live-verify",
      ruleId: "secrets.row-exposure",
      severity: "CRITICAL",
      category: "security",
      title: "Live test: one account could read another account's data",
      description: input.liveSummary ?? "Boswell signed in as two test accounts on your staging site and account B could read account A's record.",
      recommendation: "Check ownership on the server for every read: load the record, then confirm it belongs to the signed-in user before returning it. Re-run live verification to confirm.",
      confidence: 1,
    });
  }

  const items: ShipReadyItem[] = ITEMS.map((def) => {
    const coverage = def.coverage(ctx);
    const mine = open.filter((f) => belongsTo(def, f)).sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    const always = (f: ShipFinding) => Boolean(f.ruleId && def.alwaysBlock?.includes(f.ruleId));
    const serious = mine.filter((f) => always(f) || RANK[f.severity] >= RANK[def.reviewAt ?? def.blockAt]);
    const proven = serious.filter((f) => (always(f) || RANK[f.severity] >= RANK[def.blockAt]) && f.confidence >= PROOF);

    let status: ItemStatus;
    if (coverage === "not-applicable" && mine.length === 0) status = "n/a";
    else if (proven.length) status = "fail";
    else if (serious.length) status = "review";
    else if (coverage === "checked") status = "pass";
    else status = "unverified";

    const shown = status === "fail" || status === "review" ? serious : mine;
    return {
      id: def.id,
      area: def.area,
      title: def.title,
      why: def.why,
      status,
      findings: shown,
      fix: def.fix,
      steps: status === "unverified" || def.fix === "steps" ? (def.steps?.(ctx) ?? []) : [],
      prompt: status === "fail" || status === "review" ? promptFor(input.repo, def.title.toLowerCase(), serious) : null,
    };
  });

  const count = (s: ItemStatus) => items.filter((i) => i.status === s).length;
  const blockers = count("fail");
  const toReview = count("review");
  const toConfirm = count("unverified");
  const state: ShipReadyVerdict["state"] = !input.auditCompleted ? "unknown" : blockers ? "not-ready" : toReview || toConfirm ? "almost" : "ready";

  const actionable = items
    .filter((i) => i.status === "fail" || i.status === "review")
    .flatMap((i) => i.findings)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const fixAllPrompt = promptFor(input.repo, "every launch blocker and review item", actionable);

  return {
    state,
    headline: state === "not-ready" ? `Not ready to ship: ${blockers} ${blockers === 1 ? "blocker" : "blockers"}` : HEADLINE[state],
    blockers,
    toReview,
    toConfirm,
    passed: count("pass"),
    items,
    fixAllPrompt,
  };
}
