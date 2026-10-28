import net from "node:net";
import os from "node:os";
import type { CheckFinding } from "@/lib/checks/types";
import type { Session } from "@/lib/dynamic-verify/engine";
import { isBlockedAddress } from "@/lib/dynamic-verify/validate-target";

const MAX_PAGES = 8;
const NAV_TIMEOUT_MS = 20_000;
const SLOW_MS = 8_000;
const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 800 }, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true },
] as const;

type PageResult = {
  path: string;
  viewport: string;
  status: number | null;
  loadMs: number | null;
  pageErrors: string[];
  consoleErrors: string[];
  overflow: boolean;
  failed: string | null;
};

export type SmokeResult = { findings: CheckFinding[]; ran: boolean; pages: PageResult[] };

function blockedHost(hostname: string, allowPrivate: boolean) {
  if (allowPrivate) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return net.isIP(hostname) ? isBlockedAddress(hostname) : false;
}

/**
 * Loads the live site's pages in a real browser, on desktop and phone sizes,
 * and records what a visitor would hit: error pages, crashes in the page's
 * JavaScript, layouts wider than the phone screen, and very slow loads.
 *
 * The browser runs the site's own JavaScript, so it gets an empty
 * environment (none of the worker's secrets), private and metadata
 * addresses are blocked, and a test-account session cookie is scoped to
 * the site's own domain so third-party scripts never receive it.
 */
export async function runSmoke(input: { baseUrl: string; pages: string[]; session?: Session | null; allowPrivate?: boolean }): Promise<SmokeResult> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return { findings: [], ran: false, pages: [] };
  }

  let browser: import("playwright-core").Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.BOSWELL_CHROMIUM_PATH || undefined,
      env: { HOME: os.tmpdir(), PATH: process.env.PATH ?? "" },
    });
  } catch {
    return { findings: [], ran: false, pages: [] };
  }

  const base = new URL(input.baseUrl);
  const paths = ["/", ...input.pages.filter((p) => p !== "/")].slice(0, MAX_PAGES);
  const results: PageResult[] = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.isMobile });
      await context.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        return blockedHost(host, Boolean(input.allowPrivate)) ? route.abort() : route.continue();
      });
      const cookie = input.session?.cookie;
      if (cookie && cookie.includes("=")) {
        const [name, ...rest] = cookie.split("=");
        await context.addCookies([{ name, value: rest.join("="), domain: base.hostname, path: "/", secure: base.protocol === "https:", httpOnly: true }]);
      }

      for (const path of paths) {
        const page = await context.newPage();
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));
        page.on("console", (m) => {
          if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
        });
        const started = Date.now();
        let status: number | null = null;
        let failed: string | null = null;
        let overflow = false;
        try {
          const res = await page.goto(new URL(path, base).toString(), { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
          status = res?.status() ?? null;
          await page.waitForTimeout(1000); // let client-side rendering and hydration errors surface
          // Mobile emulation widens innerWidth to fit oversized content; clientWidth stays the device width.
          if (vp.isMobile) overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
        } catch (error) {
          failed = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "navigation failed";
        }
        results.push({ path, viewport: vp.name, status, loadMs: failed ? null : Date.now() - started, pageErrors, consoleErrors, overflow, failed });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return { findings: smokeFindings(results, Boolean(input.session)), ran: true, pages: results };
}

/** Turns per-page results into findings. Pure, so it's testable without a browser. */
export function smokeFindings(results: PageResult[], signedIn: boolean): CheckFinding[] {
  const out: CheckFinding[] = [];
  const desktop = results.filter((r) => r.viewport === "desktop");
  const list = (rs: PageResult[], detail: (r: PageResult) => string) => rs.slice(0, 10).map((r) => `- ${r.path} — ${detail(r)}`).join("\n");

  // Without a test session, 401/403 on a private page is correct behaviour, not breakage.
  const broken = desktop.filter((r) => r.failed || (r.status !== null && r.status >= 400 && (signedIn || (r.status !== 401 && r.status !== 403))));
  if (broken.length) {
    out.push({
      ruleId: "ops.page-broken",
      severity: "HIGH",
      category: "operations",
      title: `${broken.length} ${broken.length === 1 ? "page doesn't" : "pages don't"} load on the live site`,
      description: `Loaded in a real browser:\n\n${list(broken, (r) => r.failed ?? `HTTP ${r.status}`)}`,
      filePath: broken[0].path,
      recommendation: "Open each page yourself, check your hosting provider's logs for the error behind it, fix, and redeploy.",
      confidence: 0.9,
    });
  }

  const crashing = desktop.filter((r) => r.pageErrors.length);
  if (crashing.length) {
    out.push({
      ruleId: "ops.console-errors",
      severity: "MEDIUM",
      category: "operations",
      title: `JavaScript crashes on ${crashing.length} ${crashing.length === 1 ? "page" : "pages"}`,
      description: `Uncaught errors in the browser — usually a broken button, form or section for every visitor:\n\n${list(crashing, (r) => r.pageErrors[0])}`,
      filePath: crashing[0].path,
      recommendation: "Open the page with the browser's developer console, reproduce the error, and fix it. Error monitoring (Sentry) will catch the ones you don't see.",
      confidence: 0.85,
    });
  }

  const overflowing = results.filter((r) => r.viewport === "mobile" && r.overflow);
  if (overflowing.length) {
    out.push({
      ruleId: "web.mobile-overflow",
      severity: "LOW",
      category: "ux",
      title: `${overflowing.length} ${overflowing.length === 1 ? "page is" : "pages are"} wider than a phone screen`,
      description: `On a 390px-wide phone these pages scroll sideways — usually a fixed-width element or a long unbroken line:\n\n${list(overflowing, () => "horizontal scroll")}`,
      filePath: overflowing[0].path,
      recommendation: "Open the page at phone width in the browser's device toolbar, find the element that's too wide, and give it `max-width: 100%` (or wrap long text).",
      confidence: 0.8,
    });
  }

  const slow = desktop.filter((r) => r.loadMs !== null && r.loadMs > SLOW_MS);
  if (slow.length) {
    out.push({
      ruleId: "ops.slow-page",
      severity: "LOW",
      category: "performance",
      title: `${slow.length} ${slow.length === 1 ? "page takes" : "pages take"} more than ${SLOW_MS / 1000} seconds to load`,
      description: `Most visitors leave before a page this slow finishes:\n\n${list(slow, (r) => `${((r.loadMs ?? 0) / 1000).toFixed(1)}s`)}`,
      filePath: slow[0].path,
      recommendation: "Check what the page waits for (large images, slow API calls during server rendering, heavy scripts) and cache or defer it.",
      confidence: 0.7,
    });
  }
  return out;
}
