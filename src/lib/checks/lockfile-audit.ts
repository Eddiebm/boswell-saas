import semver from "semver";
import type { ParsedLockfile } from "@/lib/checks/lockfiles";
import type { CheckFinding, Severity } from "@/lib/checks/types";

/**
 * Vulnerability lookup for lockfiles npm can't audit itself (pnpm, yarn, bun,
 * Python, Ruby). Only package names and versions leave the worker:
 * - JavaScript: npm's bulk advisory endpoint (the database `npm audit` uses),
 * - Python and Ruby: the OSV database (osv.dev).
 */

export type FetchJson = (url: string, body: unknown) => Promise<unknown>;

const TIMEOUT_MS = 20_000;
const NPM_BULK = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_VULN = "https://api.osv.dev/v1/vulns/";
const MAX_OSV_DETAILS = 60;

export const defaultFetchJson: FetchJson = async (url, body) => {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json();
};

type Advisory = { id: string; title: string; url?: string; severity: Severity; fixedIn?: string };
type VulnerablePackage = { name: string; versions: string[]; advisories: Advisory[] };

const NPM_SEVERITY: Record<string, Severity> = { critical: "CRITICAL", high: "HIGH", moderate: "MEDIUM", low: "LOW", info: "INFO" };
const ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

async function auditNpmEcosystem(lock: ParsedLockfile, fetchJson: FetchJson): Promise<VulnerablePackage[]> {
  const names = [...lock.packages.keys()];
  const out: VulnerablePackage[] = [];
  for (let i = 0; i < names.length; i += 300) {
    const body = Object.fromEntries(names.slice(i, i + 300).map((n) => [n, [...lock.packages.get(n)!]]));
    const res = (await fetchJson(NPM_BULK, body)) as Record<string, Array<{ id: number; title: string; url?: string; severity: string; vulnerable_versions: string }>>;
    for (const [name, advisories] of Object.entries(res ?? {})) {
      const installed = [...(lock.packages.get(name) ?? [])];
      const hits = advisories.filter((a) => installed.some((v) => semver.valid(v) && semver.satisfies(v, a.vulnerable_versions, { includePrerelease: true })));
      if (!hits.length) continue;
      out.push({
        name,
        versions: installed.filter((v) => hits.some((a) => semver.satisfies(v, a.vulnerable_versions, { includePrerelease: true }))),
        advisories: hits.map((a) => ({ id: String(a.id), title: a.title, url: a.url, severity: NPM_SEVERITY[a.severity] ?? "MEDIUM" })),
      });
    }
  }
  return out;
}

type OsvVuln = {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{ package?: { name?: string }; ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
};

function osvSeverity(v: OsvVuln): Severity {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL" || label === "HIGH" || label === "LOW") return label;
  if (label === "MODERATE" || label === "MEDIUM") return "MEDIUM";
  // CVSS vector without a label: use the qualitative score if present, otherwise call it medium.
  const score = Number(v.severity?.find((s) => /^\d+(\.\d+)?$/.test(s.score))?.score);
  if (score >= 9) return "CRITICAL";
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  if (score > 0) return "LOW";
  return "MEDIUM";
}

async function auditOsv(lock: ParsedLockfile, fetchJson: FetchJson): Promise<VulnerablePackage[]> {
  const queries = [...lock.packages.entries()].flatMap(([name, versions]) => [...versions].map((version) => ({ name, version })));
  const hits = new Map<string, { versions: Set<string>; ids: Set<string> }>();
  for (let i = 0; i < queries.length; i += 500) {
    const batch = queries.slice(i, i + 500);
    const res = (await fetchJson(OSV_BATCH, { queries: batch.map((q) => ({ package: { name: q.name, ecosystem: lock.ecosystem }, version: q.version })) })) as {
      results?: Array<{ vulns?: Array<{ id: string }> }>;
    };
    res.results?.forEach((r, j) => {
      if (!r.vulns?.length) return;
      const q = batch[j];
      const entry = hits.get(q.name) ?? { versions: new Set(), ids: new Set() };
      entry.versions.add(q.version);
      r.vulns.forEach((v) => entry.ids.add(v.id));
      hits.set(q.name, entry);
    });
  }

  const details = new Map<string, OsvVuln>();
  const ids = [...new Set([...hits.values()].flatMap((h) => [...h.ids]))].slice(0, MAX_OSV_DETAILS);
  await Promise.all(
    ids.map(async (id) => {
      try {
        details.set(id, (await fetchJson(OSV_VULN + encodeURIComponent(id), undefined)) as OsvVuln);
      } catch {
        /* keep the id with no detail */
      }
    }),
  );

  return [...hits.entries()].map(([name, h]) => ({
    name,
    versions: [...h.versions],
    advisories: [...h.ids].map((id) => {
      const d = details.get(id);
      const fixedIn = d?.affected
        ?.filter((a) => a.package?.name?.toLowerCase() === name.toLowerCase())
        .flatMap((a) => a.ranges ?? [])
        .flatMap((r) => r.events ?? [])
        .map((e) => e.fixed)
        .find(Boolean);
      return { id, title: d?.summary ?? id, url: `https://osv.dev/vulnerability/${id}`, severity: d ? osvSeverity(d) : "MEDIUM", fixedIn };
    }),
  }));
}

const UPDATE_COMMAND: Record<ParsedLockfile["kind"], (name: string) => string> = {
  pnpm: (n) => `pnpm update ${n}`,
  yarn: (n) => `yarn up ${n}`,
  bun: (n) => `bun update ${n}`,
  requirements: (n) => `pin a fixed version of ${n} in requirements.txt`,
  poetry: (n) => `poetry update ${n}`,
  pipfile: (n) => `pipenv update ${n}`,
  gemfile: (n) => `bundle update ${n}`,
};

export type LockfileAuditResult = { findings: CheckFinding[]; ok: boolean; error?: string };

export async function auditLockfile(lock: ParsedLockfile, fetchJson: FetchJson = defaultFetchJson): Promise<LockfileAuditResult> {
  let vulnerable: VulnerablePackage[];
  try {
    vulnerable = lock.ecosystem === "npm" ? await auditNpmEcosystem(lock, fetchJson) : await auditOsv(lock, fetchJson);
  } catch (error) {
    return { findings: [], ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const findings = vulnerable.map((pkg): CheckFinding => {
    const worst = ORDER.find((s) => pkg.advisories.some((a) => a.severity === s)) ?? "MEDIUM";
    const fixed = pkg.advisories.map((a) => a.fixedIn).filter(Boolean) as string[];
    const label = `${pkg.name}@${pkg.versions.join(", ")}`;
    return {
      ruleId: "deps.vulnerable",
      severity: worst,
      category: "dependencies",
      title: `Vulnerable dependency: ${label}`,
      description: [
        `${pkg.advisories.length} published ${pkg.advisories.length === 1 ? "advisory" : "advisories"} for \`${label}\` in ${lock.path}:`,
        ...pkg.advisories.slice(0, 6).map((a) => `- ${a.title}${a.url ? ` (${a.url})` : ""}`),
        ...(pkg.advisories.length > 6 ? [`- …and ${pkg.advisories.length - 6} more`] : []),
      ].join("\n"),
      filePath: lock.path,
      recommendation: `Update it (\`${UPDATE_COMMAND[lock.kind](pkg.name)}\`)${fixed.length ? ` to ${fixed.sort((a, b) => (semver.valid(a) && semver.valid(b) ? semver.compare(b, a) : 0))[0]} or later` : " to a version outside the advisories' ranges"}, then run your tests. If something else pins it, update that package instead.`,
      confidence: 0.9,
    };
  });
  return { findings: findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)), ok: true };
}
