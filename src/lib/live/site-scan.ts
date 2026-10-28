import { findSecrets, maskSecret } from "@/lib/checks/hardcoded-secrets";
import type { CheckFinding } from "@/lib/checks/types";
import type { LiveFetch, LiveResponse } from "@/lib/live/http";

const MAX_SCRIPTS = 25;

/**
 * Files that must never be served. Each probe has a content check, because
 * many sites answer every unknown path with 200 and their homepage.
 */
const EXPOSED: Array<{ path: string; looksReal: (body: string, type: string) => boolean; what: string; severity: CheckFinding["severity"] }> = [
  { path: "/.env", looksReal: (b, t) => !/html/.test(t) && /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(b), what: "your environment file — every secret the app uses", severity: "CRITICAL" },
  { path: "/.env.local", looksReal: (b, t) => !/html/.test(t) && /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(b), what: "your local environment file", severity: "CRITICAL" },
  { path: "/.env.production", looksReal: (b, t) => !/html/.test(t) && /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(b), what: "your production environment file", severity: "CRITICAL" },
  { path: "/.git/HEAD", looksReal: (b) => /^ref: refs\//.test(b.trim()), what: "your git repository — anyone can download your full source code and history", severity: "CRITICAL" },
  { path: "/.git/config", looksReal: (b) => /^\[core\]/m.test(b), what: "your git configuration (and usually the whole repository)", severity: "CRITICAL" },
  { path: "/.DS_Store", looksReal: (b) => b.includes("Bud1"), what: "a macOS folder index that lists your server's files", severity: "LOW" },
];

function scriptUrls(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const urls = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin) urls.add(u.toString());
    } catch {
      /* malformed src */
    }
  }
  return [...urls].slice(0, MAX_SCRIPTS);
}

async function tryFetch(fetcher: LiveFetch, url: string): Promise<LiveResponse | null> {
  try {
    return await fetcher(url);
  } catch {
    return null;
  }
}

export type SiteScanResult = { findings: CheckFinding[]; reachable: boolean };

/** What anyone on the internet can see on the deployed site. GET requests only. */
export async function scanSite(baseUrl: string, fetcher: LiveFetch): Promise<SiteScanResult> {
  const out: CheckFinding[] = [];
  const home = await tryFetch(fetcher, baseUrl);
  if (!home || home.status >= 500) {
    return {
      reachable: false,
      findings: [
        {
          ruleId: "ops.page-broken",
          severity: "HIGH",
          category: "operations",
          title: home ? `The live site returns ${home.status}` : "The live site didn't respond",
          description: `Boswell requested ${baseUrl} and ${home ? `got HTTP ${home.status}` : "got no response within 15 seconds"}.`,
          filePath: new URL(baseUrl).pathname,
          recommendation: "Check your hosting provider's deployment and function logs for the error, then redeploy.",
          confidence: 0.9,
        },
      ],
    };
  }

  // HTTPS
  const base = new URL(home.url);
  if (base.protocol === "http:") {
    out.push({
      ruleId: "web.no-https",
      severity: "HIGH",
      category: "security",
      title: "The live site is served over plain HTTP",
      description: `${home.url} isn't encrypted: passwords and session cookies travel in clear text, and browsers mark the site "Not secure".`,
      filePath: "/",
      recommendation: "Serve the site over HTTPS (every major host does this for free) and redirect http:// to https://.",
      confidence: 0.95,
    });
  } else {
    const plain = await tryFetch(fetcher, `http://${base.host}/`);
    if (plain && plain.status < 400 && !plain.url.startsWith("https://")) {
      out.push({
        ruleId: "web.no-https",
        severity: "MEDIUM",
        category: "security",
        title: "http:// isn't redirected to https://",
        description: `http://${base.host}/ is served without encryption instead of redirecting, so anyone who types the address without https gets an insecure page.`,
        filePath: "/",
        recommendation: "Turn on \"redirect HTTP to HTTPS\" in your hosting provider (or redirect in middleware) and add a Strict-Transport-Security header.",
        confidence: 0.9,
      });
    }
  }

  // Headers actually served
  const h = home.headers;
  const missing = [
    !h.get("x-frame-options") && !/frame-ancestors/i.test(h.get("content-security-policy") ?? "") ? "X-Frame-Options or CSP frame-ancestors" : null,
    !h.get("x-content-type-options") ? "X-Content-Type-Options" : null,
    base.protocol === "https:" && !h.get("strict-transport-security") ? "Strict-Transport-Security" : null,
  ].filter(Boolean);
  if (missing.length) {
    out.push({
      ruleId: "web.live-headers",
      severity: "LOW",
      category: "security",
      title: `The live site is missing ${missing.length} security ${missing.length === 1 ? "header" : "headers"}`,
      description: `Response headers on ${home.url} don't include: ${missing.join(", ")}.`,
      filePath: "/",
      recommendation: "Set them for every route in your framework config (e.g. `headers()` in next.config) or your host's headers file, then redeploy.",
      confidence: 0.95,
    });
  }

  // Files that should never be public
  for (const probe of EXPOSED) {
    const res = await tryFetch(fetcher, new URL(probe.path, base).toString());
    if (!res || res.status !== 200 || !probe.looksReal(res.text, res.headers.get("content-type") ?? "")) continue;
    out.push({
      ruleId: probe.severity === "CRITICAL" ? "secrets.exposed-file" : "web.exposed-file",
      severity: probe.severity,
      category: probe.severity === "CRITICAL" ? "secrets" : "security",
      title: `${probe.path} is publicly downloadable`,
      description: `${new URL(probe.path, base).toString()} returns ${probe.what}.`,
      filePath: probe.path,
      recommendation:
        probe.severity === "CRITICAL"
          ? "Remove it from the deployed files now (it should never be in the build output or public folder) and rotate every secret it contained — assume it has been downloaded."
          : "Remove it from the deployed files and add it to .gitignore.",
      confidence: 0.95,
    });
  }

  // Secrets and source maps in the JavaScript every visitor downloads
  const maps: string[] = [];
  const seen = new Set<string>();
  for (const src of scriptUrls(home.text, home.url)) {
    const js = await tryFetch(fetcher, src);
    if (!js || js.status !== 200) continue;
    for (const hit of findSecrets(js.text)) {
      if (seen.has(hit.value)) continue;
      seen.add(hit.value);
      out.push({
        ruleId: "secrets.live-bundle",
        severity: "CRITICAL",
        category: "secrets",
        title: `${hit.name[0].toUpperCase()}${hit.name.slice(1)} in the live JavaScript`,
        description: `${new URL(src).pathname} — downloaded by every visitor — contains what looks like a live ${hit.name} (\`${maskSecret(hit.value)}\`).`,
        filePath: new URL(src).pathname,
        recommendation: `Rotate it now (${hit.rotate}). Then move the call that needs it to server code, and never give it a browser-exposed prefix like NEXT_PUBLIC_ or VITE_.`,
        confidence: 0.9,
      });
    }
    const mapRef = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m.exec(js.text)?.[1];
    if (mapRef && !mapRef.startsWith("data:") && maps.length < 3) {
      const mapUrl = new URL(mapRef, src).toString();
      const map = await tryFetch(fetcher, mapUrl);
      if (map && map.status === 200 && /"sources"\s*:/.test(map.text.slice(0, 2000))) maps.push(new URL(mapUrl).pathname);
    }
  }
  if (maps.length) {
    out.push({
      ruleId: "web.live-source-maps",
      severity: "MEDIUM",
      category: "security",
      title: "Source maps are downloadable from the live site",
      description: `Anyone can rebuild your original front-end source — comments and internal logic included — from:\n\n${maps.map((m) => `- ${m}`).join("\n")}`,
      filePath: maps[0],
      recommendation: "Stop serving source maps publicly. If error monitoring needs them, upload them to the monitoring service privately at build time.",
      confidence: 0.95,
    });
  }

  return { findings: out, reachable: true };
}
