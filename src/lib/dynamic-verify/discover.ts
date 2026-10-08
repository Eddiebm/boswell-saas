/**
 * Static autodiscovery for the live access-control verification module.
 *
 * Runs on the exact same file walk already produced for the AI Slop scanner
 * during a normal audit — no extra clone, no network calls. It can only
 * suggest *where* to check (a login endpoint, a per-resource GET route with
 * a dynamic id segment) from source shape. It cannot discover *who* to check
 * with: test-account credentials and a concrete resource id are runtime
 * data that doesn't exist in source, so those stay customer-supplied.
 */

export type DiscoverableFile = { path: string; content: string };

export type Confidence = "high" | "medium" | "low";

export type LoginCandidate = {
  loginPath: string;
  filePath: string;
  confidence: Confidence;
  reason: string;
};

export type ResourceCandidate = {
  resourcePathTemplate: string;
  filePath: string;
  confidence: Confidence;
  reason: string;
};

export type DiscoveryResult = {
  loginCandidates: LoginCandidate[];
  resourceCandidates: ResourceCandidate[];
};

const LOGIN_CONTENT_HINTS = ["password", "authenticate", "bcrypt", "compare(", "credentials"];

const OWNERSHIP_HINTS = [
  "session.user.id",
  "session?.user?.id",
  "userid ===",
  "ownerid ===",
  "user.id !==",
  "unauthorized",
  "forbidden",
  ".userid,",
  "requireuserid",
];

const APP_ROUTER_PATTERN = /(?:^|\/)(?:src\/)?app((?:\/[^/]+)*)\/route\.[tj]sx?$/;

function confidenceRank(c: Confidence) {
  return c === "high" ? 2 : c === "medium" ? 1 : 0;
}

function nextAppRouterUrlFromPath(filePath: string): string | null {
  const match = filePath.match(APP_ROUTER_PATTERN);
  if (!match) return null;
  return match[1] || "/";
}

function toResourceTemplate(urlPath: string): { template: string; hasDynamicSegment: boolean } {
  const hasDynamicSegment = /\[[^/]+\]/.test(urlPath);
  const template = urlPath.replace(/\[[^/]+\]/g, "{id}");
  return { template, hasDynamicSegment };
}

function extractGetHandlerBody(content: string): string {
  const match = content.match(/export\s+(?:async\s+)?function\s+GET\s*\([^)]*\)\s*{([\s\S]*)/);
  return match ? match[1] : content;
}

export function discoverVerifyCandidates(files: DiscoverableFile[]): DiscoveryResult {
  const loginCandidates: LoginCandidate[] = [];
  const resourceCandidates: ResourceCandidate[] = [];

  for (const file of files) {
    const urlPath = nextAppRouterUrlFromPath(file.path);
    if (!urlPath) continue;

    const lowerContent = file.content.toLowerCase();

    if (/export\s+(?:async\s+)?function\s+POST/.test(file.content)) {
      const matchedHints = LOGIN_CONTENT_HINTS.filter((h) => lowerContent.includes(h));
      const pathLooksLikeAuth = /login|signin|sign-in|session|auth/i.test(urlPath);
      if (matchedHints.length > 0 || pathLooksLikeAuth) {
        loginCandidates.push({
          loginPath: urlPath,
          filePath: file.path,
          confidence: matchedHints.length > 0 && pathLooksLikeAuth ? "high" : "medium",
          reason:
            matchedHints.length > 0
              ? `POST handler references "${matchedHints[0]}"`
              : "Route path looks like a login/session endpoint",
        });
      }
    }

    if (/export\s+(?:async\s+)?function\s+GET/.test(file.content)) {
      const { template, hasDynamicSegment } = toResourceTemplate(urlPath);
      if (hasDynamicSegment) {
        const body = extractGetHandlerBody(file.content).toLowerCase();
        const guarded = OWNERSHIP_HINTS.some((hint) => body.includes(hint));
        resourceCandidates.push({
          resourcePathTemplate: template,
          filePath: file.path,
          confidence: guarded ? "low" : "high",
          reason: guarded
            ? "GET handler for this id already references a user/session check — still worth proving, lower priority"
            : "GET handler reads a resource by id with no visible ownership check in this file",
        });
      }
    }
  }

  loginCandidates.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  resourceCandidates.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));

  return { loginCandidates, resourceCandidates };
}
