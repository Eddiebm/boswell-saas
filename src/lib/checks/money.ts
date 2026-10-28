import { isRouteHandler, isSourceFile } from "@/lib/checks/collect-files";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

const STRIPE_EVENTS = /checkout\.session\.completed|customer\.subscription\.\w+|invoice\.(?:paid|payment_\w+)|payment_intent\.\w+/;
const STRIPE_VERIFIED = /\.constructEvent(?:Async)?\s*\(|verifyHeader\s*\(|generateTestHeaderString/;

/** Paid AI and media APIs — a route that calls one spends the app owner's money on every request. */
const AI_USAGE =
  /from\s+["'](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|groq-sdk|cohere-ai|@mistralai\/mistralai|replicate|@fal-ai\/[\w-]+|ai|@ai-sdk\/[\w-]+|elevenlabs|@elevenlabs\/[\w-]+)["']|https:\/\/(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai\/api|api\.replicate\.com|fal\.run|queue\.fal\.run|api\.elevenlabs\.io|api\.groq\.com|api\.mistral\.ai)/;
const AUTH_SIGNAL =
  /\b(?:auth|getServerSession|getSession|currentUser|getUser|requireUser\w*|requireAuth\w*|getAuth|verifyIdToken|getToken|withAuth|validateRequest|getUserId|getOptionalUserId|requireUserId|getKindeServerSession)\s*\(|\bclerkClient\b|\bauthorization\b|\bx-api-key\b|\bCRON_SECRET\b|\bsession\?*\.user\b/i;
const RATE_LIMIT_SIGNAL = /rate[-_]?limit|ratelimit|\blimiter\b|\.limit\s*\(|throttle|quota|credits?\b|usage(?:Limit|Count)/i;
const REQUEST_INPUT = /\breq(?:uest)?\.(?:json|formData)\s*\(|\breq\.body\b/;

/** Next.js middleware/proxy that guards API routes covers every handler under it. */
function middlewareGuards(files: RepoFile[]) {
  const mw = files.find((f) => /(^|\/)(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(f.path));
  if (!mw) return { auth: false, rateLimit: false };
  const coversApi = !/matcher/.test(mw.content) || /["'`][^"'`]*\/api/.test(mw.content);
  return { auth: coversApi && AUTH_SIGNAL.test(mw.content), rateLimit: coversApi && RATE_LIMIT_SIGNAL.test(mw.content) };
}

/**
 * The ways a launched app loses money without anyone noticing:
 * - a Stripe webhook that believes any POST, so anyone can fake "payment succeeded",
 * - a checkout that takes the price from the browser,
 * - an AI route anyone on the internet can call, billed to you per request.
 */
export function checkMoney(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const guards = middlewareGuards(files);
  const openAiRoutes: Array<{ file: RepoFile; index: number }> = [];
  const unlimitedAiRoutes: Array<{ file: RepoFile; index: number }> = [];

  for (const f of files) {
    if (!isSourceFile(f) || !isRouteHandler(f)) continue;

    const event = STRIPE_EVENTS.exec(f.content);
    if (event && /stripe/i.test(f.content) && !STRIPE_VERIFIED.test(f.content)) {
      out.push({
        ruleId: "money.webhook-unverified",
        severity: "CRITICAL",
        category: "payments",
        title: "Stripe webhook doesn't verify the signature",
        description: `This route handles Stripe events (\`${event[0]}\`) but never checks the \`stripe-signature\` header. Anyone can POST a fake "payment succeeded" event to it and get a paid plan, credits or an order for free.`,
        filePath: f.path,
        lineStart: lineOf(f.content, event.index),
        recommendation: "Read the raw body (`await req.text()`), then `stripe.webhooks.constructEvent(body, req.headers.get(\"stripe-signature\"), process.env.STRIPE_WEBHOOK_SECRET)` and reject the request if it throws.",
        confidence: 0.85,
      });
    }

    const price = /\b(?:unit_amount|amount)\s*:\s*(?:Math\.\w+\()?\s*(?:body|data|input|params|payload|req\.body|json)\b[\w.?[\]"']*/.exec(f.content);
    if (price && /stripe|checkout|paymentIntents/i.test(f.content) && REQUEST_INPUT.test(f.content)) {
      out.push({
        ruleId: "money.client-price",
        severity: "HIGH",
        category: "payments",
        title: "Checkout takes the price from the request",
        description: `\`${price[0].slice(0, 80)}\` sets the charge from data the browser sent. Anyone can edit the request and pay $0.01 for anything.\n\nNeeds review: Boswell matched this by pattern.`,
        filePath: f.path,
        lineStart: lineOf(f.content, price.index),
        recommendation: "Send only a product or plan ID from the browser and look the price up on the server (or use a Stripe Price ID created in the dashboard).",
        confidence: 0.6,
      });
    }

    const ai = AI_USAGE.exec(f.content);
    if (ai && !/^\s*["']use client["']/m.test(f.content.slice(0, 200))) {
      const authed = guards.auth || AUTH_SIGNAL.test(f.content);
      const limited = guards.rateLimit || RATE_LIMIT_SIGNAL.test(f.content);
      if (!authed) openAiRoutes.push({ file: f, index: ai.index });
      else if (!limited) unlimitedAiRoutes.push({ file: f, index: ai.index });
    }
  }

  const list = (routes: Array<{ file: RepoFile; index: number }>) => [
    ...routes.slice(0, 10).map((r) => `- ${r.file.path}:${lineOf(r.file.content, r.index)}`),
    ...(routes.length > 10 ? [`- …and ${routes.length - 10} more`] : []),
  ];

  if (openAiRoutes.length) {
    const [first] = openAiRoutes;
    out.push({
      ruleId: "money.ai-route-no-auth",
      severity: "HIGH",
      category: "payments",
      title: `${openAiRoutes.length} paid AI ${openAiRoutes.length === 1 ? "route has" : "routes have"} no login check`,
      description: [
        "These routes call a paid AI or media API, and nothing in them (or in middleware) checks who's calling. A script can hit them thousands of times an hour, and every call is billed to you — this is how apps wake up to a four-figure API bill:",
        "",
        ...list(openAiRoutes),
        "",
        "Needs review: if a route is deliberately public (a free demo), it still needs a rate limit and a spending cap.",
      ].join("\n"),
      filePath: first.file.path,
      lineStart: lineOf(first.file.content, first.index),
      recommendation: "Require a signed-in user at the top of each route, add a per-user rate limit, and set a monthly spending limit with the API provider as a backstop.",
      confidence: 0.65,
    });
  }
  if (unlimitedAiRoutes.length) {
    const [first] = unlimitedAiRoutes;
    out.push({
      ruleId: "money.ai-route-no-ratelimit",
      severity: "MEDIUM",
      category: "payments",
      title: `${unlimitedAiRoutes.length} paid AI ${unlimitedAiRoutes.length === 1 ? "route has" : "routes have"} no rate limit`,
      description: [
        "These routes require a login but don't limit how often one user can call them. A single free-tier account (or a stolen session) can run up your AI bill:",
        "",
        ...list(unlimitedAiRoutes),
      ].join("\n"),
      filePath: first.file.path,
      lineStart: lineOf(first.file.content, first.index),
      recommendation: "Add a per-user limit (e.g. `@upstash/ratelimit`, or a usage counter in your database checked before each call) and a monthly spending cap with the API provider.",
      confidence: 0.6,
    });
  }
  return out;
}
