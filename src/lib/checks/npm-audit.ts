import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CheckFinding, Severity } from "@/lib/checks/types";

/* ------------------------------------------------------------------ */
/* Isolated runner                                                     */
/* ------------------------------------------------------------------ */

/**
 * Environment variables npm is allowed to see. Everything else — including
 * the worker's DATABASE_URL, API keys and GitHub tokens — is withheld, so
 * nothing npm does can read Boswell's own secrets.
 */
const PASSTHROUGH_ENV = [
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "npm_config_https_proxy", "npm_config_proxy", "npm_config_cafile",
];
const REGISTRY = "https://registry.npmjs.org/";
const NPM_TIMEOUT_MS = 90_000;

export type NpmEnv = Record<string, string | undefined>;
export type NpmExec = (args: string[], cwd: string, env: NpmEnv) => Promise<{ stdout: string; stderr: string; code: number }>;

const defaultExec: NpmExec = (args, cwd, env) =>
  new Promise((resolve) => {
    execFile("npm", args, { cwd, env: env as NodeJS.ProcessEnv, timeout: NPM_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

export type AuditCounts = { info: number; low: number; moderate: number; high: number; critical: number; total: number };

export type NpmAuditReport = {
  vulnerabilities?: Record<string, AuditVulnerability>;
  metadata?: { vulnerabilities?: AuditCounts };
};

export type AuditAdvisory = { title: string; url?: string; severity: string; range?: string; name?: string };

export type AuditVulnerability = {
  name: string;
  severity: string;
  via: Array<AuditAdvisory | string>;
  effects?: string[];
  nodes?: string[];
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
};

export type IsolatedAuditResult =
  | {
      ok: true;
      before: NpmAuditReport;
      after?: NpmAuditReport;
      patchedLockfile?: string;
      patchedPackageJson?: string;
      pinBumps: PinBump[];
      fixError?: string;
    }
  | { ok: false; error: string };

/**
 * Runs `npm audit` (and optionally `npm audit fix`) on a copy of just
 * package.json + package-lock.json in an empty temp directory:
 * - no repository code, .npmrc, or install scripts are present or executed
 *   (`--package-lock-only` resolves from the registry without installing;
 *   `--ignore-scripts` belt-and-braces),
 * - the registry is pinned, so a repo can't redirect npm elsewhere,
 * - npm sees none of the worker's secrets (see PASSTHROUGH_ENV).
 */
export async function runIsolatedNpmAudit(
  input: { packageJson: string; lockfile: string; fix: boolean },
  exec: NpmExec = defaultExec,
): Promise<IsolatedAuditResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boswell-npm-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), input.packageJson);
    fs.writeFileSync(path.join(dir, "package-lock.json"), input.lockfile);

    const env: NpmEnv = { PATH: process.env.PATH, HOME: dir, npm_config_cache: path.join(dir, ".npm-cache") };
    for (const key of PASSTHROUGH_ENV) if (process.env[key]) env[key] = process.env[key];

    const common = ["--package-lock-only", "--ignore-scripts", `--registry=${REGISTRY}`, "--no-fund"];
    const audit = async (): Promise<{ report: NpmAuditReport } | { error: string }> => {
      const r = await exec(["audit", "--json", ...common], dir, env);
      // npm exits non-zero whenever vulnerabilities exist; only unparseable output is a failure.
      try {
        const parsed = JSON.parse(r.stdout) as NpmAuditReport & { error?: { summary?: string } };
        if (parsed.error) return { error: parsed.error.summary ?? "npm audit returned an error" };
        return { report: parsed };
      } catch {
        return { error: (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ") || `npm audit exited ${r.code}` };
      }
    };

    const before = await audit();
    if ("error" in before) return { ok: false, error: before.error };
    if (!input.fix) return { ok: true, before: before.report, pinBumps: [] };

    const fixRun = await exec(["audit", "fix", ...common], dir, env);
    let after = await audit();

    // `audit fix` only moves versions within the ranges package.json allows. When a direct dependency is
    // pinned (`"next": "16.2.10"`) and the fix is a non-breaking release outside that pin, raise the pin.
    const pinBumps = "report" in after ? planPinBumps(input.packageJson, after.report) : [];
    let patchedPackageJson: string | undefined;
    if (pinBumps.length) {
      patchedPackageJson = applyPinBumps(input.packageJson, pinBumps);
      fs.writeFileSync(path.join(dir, "package.json"), patchedPackageJson);
      await exec(["install", ...common, "--no-audit"], dir, env);
      after = await audit();
    }

    const patchedLockfile = fs.readFileSync(path.join(dir, "package-lock.json"), "utf8");
    if (patchedLockfile === input.lockfile && !patchedPackageJson) {
      // npm exits non-zero both when it fixed nothing and when it crashed; only an `npm error` line means the latter.
      const crash = /^npm error (?!code E?AUDIT).*$/m.exec(fixRun.stderr);
      return { ok: true, before: before.report, pinBumps: [], fixError: crash ? crash[0].replace(/^npm error /, "") : undefined };
    }

    return {
      ok: true,
      before: before.report,
      after: "report" in after ? after.report : undefined,
      patchedLockfile: patchedLockfile === input.lockfile ? undefined : patchedLockfile,
      patchedPackageJson,
      pinBumps,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Pin bumps                                                           */
/* ------------------------------------------------------------------ */

export type PinBump = { name: string; field: string; from: string; to: string };

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/** `16.2.10` → `16.4.3`, `^1.2.0` → `^1.4.0`; null for anything that isn't a plain version (ranges, tags, git URLs). */
export function bumpSpec(spec: string, version: string): string | null {
  const m = /^(\^|~|=)?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(spec.trim());
  if (!m || compareVersions(version, m[2]) <= 0) return null;
  return `${m[1] ?? ""}${version}`;
}

export function planPinBumps(packageJson: string, report: NpmAuditReport): PinBump[] {
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return [];
  }
  const bumps = new Map<string, PinBump>();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    const fix = vuln.fixAvailable;
    if (typeof fix !== "object" || fix.isSemVerMajor || bumps.has(fix.name)) continue;
    for (const field of DEP_FIELDS) {
      const spec = pkg[field]?.[fix.name];
      const to = spec ? bumpSpec(spec, fix.version) : null;
      if (spec && to) {
        bumps.set(fix.name, { name: fix.name, field, from: spec, to });
        break;
      }
    }
  }
  return [...bumps.values()];
}

/** Rewrites only the bumped specs, keeping the file's indentation and key order. */
export function applyPinBumps(packageJson: string, bumps: PinBump[]): string {
  const pkg = JSON.parse(packageJson) as Record<string, Record<string, string>>;
  for (const b of bumps) pkg[b.field][b.name] = b.to;
  const indent = /^[ \t]+(?=")/m.exec(packageJson)?.[0] ?? "  ";
  return JSON.stringify(pkg, null, indent) + (packageJson.endsWith("\n") ? "\n" : "");
}

/* ------------------------------------------------------------------ */
/* Triage                                                              */
/* ------------------------------------------------------------------ */

type LockPackages = Record<string, { version?: string; dev?: boolean; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>;

const SEVERITY: Record<string, Severity> = { critical: "CRITICAL", high: "HIGH", moderate: "MEDIUM", low: "LOW", info: "INFO" };
const STEP_DOWN: Record<Severity, Severity> = { CRITICAL: "HIGH", HIGH: "MEDIUM", MEDIUM: "LOW", LOW: "LOW", INFO: "INFO" };

function nameFromNode(node: string): string {
  const parts = node.split("node_modules/");
  return parts[parts.length - 1];
}

/** Top-level dependencies (declared in package.json) whose dependency tree includes `pkg`. */
export function findIntroducers(packages: LockPackages, pkg: string): string[] {
  const root = packages[""] ?? {};
  const topLevel = new Set(Object.keys({ ...root.dependencies, ...(root as { devDependencies?: Record<string, string> }).devDependencies, ...root.optionalDependencies }));
  if (topLevel.has(pkg)) return [pkg];

  const dependents = new Map<string, Set<string>>();
  for (const [key, info] of Object.entries(packages)) {
    if (!key) continue;
    const parent = nameFromNode(key);
    for (const dep of Object.keys({ ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies })) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(parent);
    }
  }

  const found = new Set<string>();
  const seen = new Set<string>([pkg]);
  const queue = [pkg];
  while (queue.length) {
    const current = queue.shift()!;
    for (const parent of dependents.get(current) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (topLevel.has(parent)) found.add(parent);
      else queue.push(parent);
    }
  }
  return [...found].sort();
}

/** Numeric major.minor.patch comparison; prerelease tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** npm sometimes "fixes" by moving a parent to an older release that predates the vulnerable dependency. */
function isDowngrade(packages: LockPackages, fix: { name: string; version: string }) {
  const current = packages[`node_modules/${fix.name}`]?.version;
  return current !== undefined && compareVersions(fix.version, current) < 0;
}

function describeFix(pkg: string, fix: AuditVulnerability["fixAvailable"], packages: LockPackages): { text: string; lockfileOnly: boolean } {
  if (fix === true) return { text: "Fixable without breaking changes — a patched version fits within the range its parent already allows, so it's a lockfile-only update.", lockfileOnly: true };
  if (fix === false) return { text: "No patched version has been published yet. Watch the advisory, or remove/replace the package if it's reachable from untrusted input.", lockfileOnly: false };
  if (isDowngrade(packages, fix)) {
    const current = packages[`node_modules/${fix.name}`]?.version;
    return { text: `No real fix yet: \`${fix.name}\` pins a vulnerable \`${pkg}\`, and npm's only suggestion is moving \`${fix.name}\` back from ${current} to ${fix.version} — an older release, not a fix. Wait for a \`${fix.name}\` release that updates \`${pkg}\`.`, lockfileOnly: false };
  }
  if (!fix.isSemVerMajor) return { text: `Fixable by updating \`${fix.name}\` to ${fix.version} (no breaking change).`, lockfileOnly: true };
  if (fix.name === pkg) return { text: `Fixing it needs a major upgrade of \`${pkg}\` to ${fix.version}. Breaking changes are likely — plan it rather than auto-applying it.`, lockfileOnly: false };
  return { text: `Blocked by \`${fix.name}\`, which pins a vulnerable \`${pkg}\`. The fix requires upgrading \`${fix.name}\` to ${fix.version} (a major version), so it can't be patched in place.`, lockfileOnly: false };
}

/**
 * Turns an npm audit report into one finding per *vulnerable* package —
 * not one per advisory, and not for packages only flagged because they
 * depend on a vulnerable one — with where it comes from, whether it ships
 * to production, and what fixing it actually takes.
 */
export function triageAudit(input: {
  report: NpmAuditReport;
  lockfile: string;
  lockfilePath: string;
  /** The audit of Boswell's patched lockfile, when there is one — the only proof a fix PR clears a finding. */
  afterFix?: NpmAuditReport;
}): CheckFinding[] {
  let packages: LockPackages = {};
  try {
    packages = (JSON.parse(input.lockfile) as { packages?: LockPackages }).packages ?? {};
  } catch {
    /* triage still works without the lockfile, just with less context */
  }

  const out: CheckFinding[] = [];
  for (const vuln of Object.values(input.report.vulnerabilities ?? {})) {
    const advisories = vuln.via.filter((v): v is AuditAdvisory => typeof v === "object");
    if (advisories.length === 0) continue;

    const nodes = vuln.nodes ?? [];
    const versions = [...new Set(nodes.map((n) => packages[n]?.version).filter(Boolean))];
    const devOnly = nodes.length > 0 && nodes.every((n) => packages[n]?.dev === true);
    const introducers = findIntroducers(packages, vuln.name);
    const fix = describeFix(vuln.name, vuln.fixAvailable, packages);
    const remaining = input.afterFix?.vulnerabilities?.[vuln.name];
    const remainingAdvisories = remaining ? remaining.via.filter((v) => typeof v === "object").length : 0;
    const prNote = !input.afterFix
      ? ""
      : remainingAdvisories === 0
        ? " Boswell's dependency fix PR applies this — review and merge it."
        : remainingAdvisories < advisories.length
          ? ` Boswell's dependency fix PR clears ${advisories.length - remainingAdvisories} of these ${advisories.length} advisories; the rest need the step above.`
          : fix.lockfileOnly
            ? " npm couldn't apply this one automatically (usually a peer-dependency conflict); run `npm audit fix` locally to see why."
            : "";

    const npmSeverity = SEVERITY[vuln.severity] ?? "MEDIUM";
    const severity = devOnly ? STEP_DOWN[npmSeverity] : npmSeverity;
    const label = versions.length ? `${vuln.name}@${versions.join(", ")}` : vuln.name;

    const lines = [
      `${advisories.length} published ${advisories.length === 1 ? "advisory" : "advisories"} for \`${label}\` (npm rates it ${vuln.severity}):`,
      ...advisories.slice(0, 6).map((a) => `- ${a.title}${a.url ? ` (${a.url})` : ""}`),
      ...(advisories.length > 6 ? [`- …and ${advisories.length - 6} more`] : []),
      "",
      introducers.length && introducers[0] !== vuln.name
        ? `Comes in through: ${introducers.map((i) => `\`${i}\``).join(", ")} — you don't depend on it directly.`
        : "You depend on it directly.",
      devOnly
        ? "Exposure: development/build-time only — it doesn't ship in your production install, so severity is shown one level lower than npm's rating."
        : "Exposure: installed in production.",
      ...(vuln.effects?.length ? [`Also flags: ${vuln.effects.map((e) => `\`${e}\``).join(", ")} (they depend on it).`] : []),
    ];

    out.push({
      ruleId: "deps.vulnerable",
      severity,
      category: "dependencies",
      title: `Vulnerable dependency: ${label}`,
      description: lines.join("\n"),
      filePath: input.lockfilePath,
      recommendation: fix.text + prNote,
      confidence: 0.95,
    });
  }

  const order: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/* ------------------------------------------------------------------ */
/* Lockfile diff for the fix PR                                        */
/* ------------------------------------------------------------------ */

export type PackageChange = { name: string; from: string | null; to: string | null };

export function diffLockfiles(before: string, after: string): PackageChange[] {
  const a = (JSON.parse(before) as { packages?: LockPackages }).packages ?? {};
  const b = (JSON.parse(after) as { packages?: LockPackages }).packages ?? {};
  const changes = new Map<string, PackageChange>();
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!key) continue;
    const from = a[key]?.version ?? null;
    const to = b[key]?.version ?? null;
    if (from === to) continue;
    const name = nameFromNode(key);
    const id = `${name}:${from}->${to}`;
    if (!changes.has(id)) changes.set(id, { name, from, to });
  }
  return [...changes.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/* ------------------------------------------------------------------ */
/* What's still blocked after the fix PR                               */
/* ------------------------------------------------------------------ */

/**
 * After the lockfile-only fixes, whatever is left usually traces back to one
 * pinned parent (most often the framework) that needs a major upgrade. Say
 * that once, per parent, instead of leaving it implied across N findings.
 */
export function summarizeBlockers(input: { report: NpmAuditReport; lockfile: string; packageJsonPath: string }): CheckFinding[] {
  let packages: LockPackages = {};
  try {
    packages = (JSON.parse(input.lockfile) as { packages?: LockPackages }).packages ?? {};
  } catch {
    /* without the lockfile, downgrades can't be told apart from upgrades */
  }
  const byParent = new Map<string, { version: string; packages: Set<string>; worst: Severity }>();
  const order: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  for (const vuln of Object.values(input.report.vulnerabilities ?? {})) {
    if (!vuln.via.some((v) => typeof v === "object")) continue;
    const fix = vuln.fixAvailable;
    // A suggested downgrade isn't an upgrade path; triage already says there's no real fix.
    if (typeof fix !== "object" || !fix.isSemVerMajor || isDowngrade(packages, fix)) continue;
    const entry = byParent.get(fix.name) ?? { version: fix.version, packages: new Set<string>(), worst: "INFO" as Severity };
    entry.packages.add(vuln.name);
    const sev = SEVERITY[vuln.severity] ?? "MEDIUM";
    if (order.indexOf(sev) < order.indexOf(entry.worst)) entry.worst = sev;
    byParent.set(fix.name, entry);
  }

  return [...byParent.entries()].map(([parent, info]) => {
    const pkgs = [...info.packages].sort();
    const self = pkgs.length === 1 && pkgs[0] === parent;
    return {
      ruleId: "deps.upgrade-blocker",
      severity: info.worst === "CRITICAL" ? "HIGH" : info.worst === "HIGH" ? "MEDIUM" : "LOW",
      category: "deploy",
      title: `Upgrading \`${parent}\` to ${info.version} is blocking ${self ? "its own security fix" : `${pkgs.length} security ${pkgs.length === 1 ? "fix" : "fixes"}`}`,
      description: self
        ? `\`${parent}\` has a published vulnerability (worst: ${info.worst.toLowerCase()}) that's only fixed in ${info.version}, a new major version. Lockfile updates can't reach it.`
        : `These vulnerable packages can't be patched in place because \`${parent}\` pins them, and the fixed versions only ship with \`${parent}@${info.version}\` — a new major version:\n\n${pkgs.map((p) => `- \`${p}\``).join("\n")}\n\nThis is what's left after Boswell's lockfile-only fixes; it needs a planned upgrade.`,
      filePath: input.packageJsonPath,
      recommendation: `Plan the \`${parent}\` ${info.version.split(".")[0]}.x upgrade: read its migration guide, upgrade on a branch, and let CI and a preview deploy prove it before merging.`,
      confidence: 0.9,
    };
  });
}

/** git's object id for a file's contents — lets the PR step tell if the lockfile changed since the audit. */
export function gitBlobSha(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}
