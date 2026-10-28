import fs from "node:fs";
import path from "node:path";
import { collectRepoFiles } from "@/lib/checks/collect-files";
import { checkEnvVars } from "@/lib/checks/env-vars";
import { checkIntegrations } from "@/lib/checks/integrations";
import { checkLockfileDrift } from "@/lib/checks/lockfile-drift";
import {
  diffLockfiles,
  gitBlobSha,
  runIsolatedNpmAudit,
  summarizeBlockers,
  triageAudit,
  type AuditCounts,
  type NpmExec,
  type PackageChange,
  type PinBump,
} from "@/lib/checks/npm-audit";
import { checkOutbound } from "@/lib/checks/outbound";
import { checkRefreshWipe } from "@/lib/checks/refresh-wipe";
import { checkSecretExposure } from "@/lib/checks/secrets";
import { checkHardcodedSecrets } from "@/lib/checks/hardcoded-secrets";
import { checkDatabaseRules } from "@/lib/checks/database-rules";
import { checkMoney } from "@/lib/checks/money";
import { checkLaunchBasics, type StackFacts } from "@/lib/checks/launch-basics";
import { findLockfiles } from "@/lib/checks/lockfiles";
import { auditLockfile, type FetchJson } from "@/lib/checks/lockfile-audit";
import { checkGitHistorySecrets, type GitLog } from "@/lib/checks/git-history";
import { checkAuthorization } from "@/lib/checks/authz";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

export { annotateSiblings } from "@/lib/checks/siblings";
export type { CheckFinding } from "@/lib/checks/types";

/** A lockfile Boswell patched in isolation, ready to become a fix PR. */
export type DependencyFix = {
  lockfilePath: string;
  baseLockfileBlobSha: string;
  patchedLockfile: string;
  packageJsonPath: string;
  basePackageJsonBlobSha: string;
  /** Set only when a direct dependency's pin had to be raised to reach a non-breaking fix. */
  patchedPackageJson: string | null;
  pinBumps: PinBump[];
  changes: PackageChange[];
  beforeCounts: AuditCounts | null;
  afterCounts: AuditCounts | null;
};

export type Coverage = "checked" | "unverifiable" | "not-applicable";

/**
 * What the checks were able to look at, saved with the audit. A clean result
 * only counts as a pass on Ship Ready when the check actually ran.
 */
export type ChecksSummary = {
  version: 1;
  coverage: {
    dependencies: Coverage;
    databaseRules: Coverage;
    /** Set when the audit also checked the deployed app (absent on older audits and when no live URL is set). */
    liveSite?: Coverage;
    smoke?: Coverage;
  };
  facts: StackFacts | null;
};

export type RepoCheckResult = { findings: CheckFinding[]; dependencyFixes: DependencyFix[]; files: RepoFile[]; summary: ChecksSummary };

const OTHER_LOCKFILES = ["yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"];
const NOT_A_PROJECT = /(^|\/)(examples?|fixtures?|__tests__|tests?|templates?|demo)\//;
const MAX_PROJECTS = 5;
/** Total wall-clock budget for npm across all projects, so a slow registry can't push the worker past its timeout. */
const DEPENDENCY_AUDIT_BUDGET_MS = 5 * 60_000;

/**
 * Workspaces and local `file:`/`link:` dependencies point at folders that don't
 * exist in the isolated copy, so `audit fix` there could drop them from the
 * lockfile. Those projects are audited but not patched.
 */
function canPatchInIsolation(packageJson: string): boolean {
  try {
    const pkg = JSON.parse(packageJson) as Record<string, unknown>;
    if (pkg.workspaces) return false;
    const specs = ["dependencies", "devDependencies", "optionalDependencies"].flatMap((field) =>
      Object.values((pkg[field] as Record<string, string> | undefined) ?? {}),
    );
    return !specs.some((spec) => /^(?:file|link|workspace|portal):/.test(spec));
  } catch {
    return false;
  }
}

/** Last line of defence before a patch can become a PR: it must parse and still match its package.json. */
function isSoundPatch(packageJson: string, lockfile: string, dir: string): boolean {
  try {
    JSON.parse(lockfile);
  } catch {
    return false;
  }
  return checkLockfileDrift({ dir, packageJson, lockfile, otherLockfiles: [] }).length === 0;
}

function lockfilesAbove(repoDir: string, dir: string): string[] {
  const found: string[] = [];
  let current = dir;
  for (;;) {
    for (const name of [...OTHER_LOCKFILES, "package-lock.json"]) {
      if (fs.existsSync(path.join(repoDir, current, name))) found.push(name);
    }
    if (current === "" || found.length) return found;
    current = path.posix.dirname(current) === "." ? "" : path.posix.dirname(current);
  }
}

function safely(name: string, run: () => CheckFinding[]): CheckFinding[] {
  try {
    return run();
  } catch (error) {
    console.error(`[checks] ${name} failed`, error);
    return [];
  }
}

/**
 * Boswell's own deterministic and pattern-based checks, run on the cloned
 * repo after the engine. Nothing here executes the repository's code: files
 * are only read, and npm only ever sees copies of package.json and
 * package-lock.json in an isolated directory (see runIsolatedNpmAudit).
 */
export async function runRepoChecks(
  repoDir: string,
  options: { dependencyAudit?: boolean; exec?: NpmExec; fetchJson?: FetchJson; gitLog?: GitLog } = {},
): Promise<RepoCheckResult> {
  const files = collectRepoFiles(repoDir);
  // Directories whose dependencies were actually audited, by npm or by lockfile lookup.
  const auditedDirs = new Set<string>();
  const deadline = Date.now() + DEPENDENCY_AUDIT_BUDGET_MS;
  const findings: CheckFinding[] = [];
  const dependencyFixes: DependencyFix[] = [];

  const projects = files
    .filter((f) => path.posix.basename(f.path) === "package.json" && !NOT_A_PROJECT.test(f.path))
    .slice(0, MAX_PROJECTS);

  for (const pkgFile of projects) {
    const dir = path.posix.dirname(pkgFile.path) === "." ? "" : path.posix.dirname(pkgFile.path);
    const lockPath = path.posix.join(dir, "package-lock.json");
    const lockAbs = path.join(repoDir, lockPath);
    const lockBuf = fs.existsSync(lockAbs) ? fs.readFileSync(lockAbs) : null;
    const lockfile = lockBuf ? lockBuf.toString("utf8") : null;

    findings.push(
      ...safely("lockfile-drift", () =>
        checkLockfileDrift({ dir, packageJson: pkgFile.content, lockfile, otherLockfiles: lockfile ? [] : lockfilesAbove(repoDir, dir) }),
      ),
    );

    if (!lockfile || !lockBuf || options.dependencyAudit === false) continue;
    try {
      JSON.parse(lockfile);
    } catch {
      continue; // reported by the drift check
    }

    if (Date.now() > deadline) {
      findings.push({
        ruleId: "deps.audit-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: "Dependency audit skipped: time budget used up",
        description: `Boswell audited the first projects in this repo and ran out of time before ${lockPath}.`,
        filePath: lockPath,
        recommendation: "Run `npm audit` in this directory locally.",
        confidence: 1,
      });
      continue;
    }

    const patchable = canPatchInIsolation(pkgFile.content);
    const result = await runIsolatedNpmAudit({ packageJson: pkgFile.content, lockfile, fix: patchable }, options.exec).catch(
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
    );
    if (!result.ok) {
      findings.push({
        ruleId: "deps.audit-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: "Dependency audit couldn't run",
        description: `Boswell couldn't audit ${lockPath}: ${result.error.slice(0, 300)}`,
        filePath: lockPath,
        recommendation: "Run `npm audit` locally to check for vulnerable dependencies.",
        confidence: 1,
      });
      continue;
    }

    auditedDirs.add(dir);
    const patched =
      Boolean(result.patchedLockfile || result.patchedPackageJson) &&
      isSoundPatch(result.patchedPackageJson ?? pkgFile.content, result.patchedLockfile ?? lockfile, dir);
    findings.push(
      ...safely("npm-audit", () =>
        triageAudit({ report: result.before, lockfile, lockfilePath: lockPath, afterFix: patched ? result.after : undefined }),
      ),
    );
    findings.push(...safely("blockers", () => summarizeBlockers(
          patched
            ? { report: result.after ?? result.before, lockfile: result.patchedLockfile ?? lockfile, packageJsonPath: pkgFile.path }
            : { report: result.before, lockfile, packageJsonPath: pkgFile.path },
        )));

    if (result.fixError) {
      findings.push({
        ruleId: "deps.fix-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: "Boswell couldn't prepare a dependency fix for this lockfile",
        description: `\`npm audit fix\` failed on ${lockPath}: ${result.fixError.slice(0, 300)}`,
        filePath: lockPath,
        recommendation: "Run `npm audit fix` locally with npm 11 or newer and commit the updated lockfile.",
        confidence: 1,
      });
    }

    if (patched) {
      const patchedLockfile = result.patchedLockfile ?? lockfile;
      dependencyFixes.push({
        lockfilePath: lockPath,
        baseLockfileBlobSha: gitBlobSha(lockBuf),
        patchedLockfile,
        packageJsonPath: pkgFile.path,
        basePackageJsonBlobSha: gitBlobSha(fs.readFileSync(path.join(repoDir, pkgFile.path))),
        patchedPackageJson: result.patchedPackageJson ?? null,
        pinBumps: result.pinBumps,
        changes: diffLockfiles(lockfile, patchedLockfile),
        beforeCounts: result.before.metadata?.vulnerabilities ?? null,
        afterCounts: result.after?.metadata?.vulnerabilities ?? null,
      });
    }
  }

  // pnpm / yarn / bun / Python / Ruby lockfiles: advisory lookups by name and version, no package manager runs.
  const otherLockfiles = options.dependencyAudit === false ? [] : findLockfiles(repoDir);
  const otherEcosystems = new Set<string>();
  for (const lock of otherLockfiles) {
    const dir = path.posix.dirname(lock.path.split(path.sep).join("/"));
    const lockDir = dir === "." ? "" : dir;
    if (lock.ecosystem !== "npm") otherEcosystems.add(lock.path);
    if (Date.now() > deadline) {
      findings.push({
        ruleId: "deps.audit-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: "Dependency audit skipped: time budget used up",
        description: `Boswell ran out of time before checking ${lock.path}.`,
        filePath: lock.path,
        recommendation: "Run your package manager's audit locally.",
        confidence: 1,
      });
      continue;
    }
    const result = await auditLockfile(lock, options.fetchJson);
    if (!result.ok) {
      findings.push({
        ruleId: "deps.audit-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: "Dependency audit couldn't run",
        description: `Boswell couldn't look up advisories for ${lock.path}: ${(result.error ?? "").slice(0, 300)}`,
        filePath: lock.path,
        recommendation: "Run your package manager's audit locally.",
        confidence: 1,
      });
      continue;
    }
    findings.push(...result.findings);
    if (lock.unresolved.length) {
      // Partly checked: the pinned entries were looked up, these weren't, so coverage stays unverified.
      findings.push({
        ruleId: "deps.audit-unavailable",
        severity: "INFO",
        category: "dependencies",
        title: `${lock.unresolved.length} ${lock.unresolved.length === 1 ? "dependency" : "dependencies"} in ${lock.path} couldn't be checked`,
        description: `These entries don't pin an exact version, so Boswell can't tell which release you install:\n\n${lock.unresolved
          .slice(0, 10)
          .map((u) => `- \`${u}\``)
          .join("\n")}${lock.unresolved.length > 10 ? `\n- …and ${lock.unresolved.length - 10} more` : ""}`,
        filePath: lock.path,
        recommendation: "Pin exact versions (`pip freeze > requirements.txt`, or use a lockfile such as poetry.lock or uv.lock) so every install gets the same, checkable release.",
        confidence: 1,
      });
      continue;
    }
    if (lock.ecosystem === "npm") auditedDirs.add(lockDir);
    else otherEcosystems.delete(lock.path);
  }

  try {
    findings.push(...(await checkGitHistorySecrets(repoDir, files, options.gitLog)));
  } catch (error) {
    console.error("[checks] git-history failed", error);
  }

  findings.push(...safely("integrations", () => checkIntegrations(files)));
  findings.push(...safely("env-vars", () => checkEnvVars(files)));
  findings.push(...safely("outbound", () => checkOutbound(files)));
  findings.push(...safely("secrets", () => checkSecretExposure(files)));
  findings.push(...safely("refresh-wipe", () => checkRefreshWipe(files)));
  findings.push(...safely("hardcoded-secrets", () => checkHardcodedSecrets(files)));
  findings.push(...safely("money", () => checkMoney(files)));
  findings.push(...safely("authorization", () => checkAuthorization(files)));

  let databaseRules: Coverage = "unverifiable";
  findings.push(
    ...safely("database-rules", () => {
      const result = checkDatabaseRules(files);
      databaseRules = result.coverage;
      return result.findings;
    }),
  );
  let facts: StackFacts | null = null;
  findings.push(
    ...safely("launch-basics", () => {
      const result = checkLaunchBasics(files);
      facts = result.facts;
      return result.findings;
    }),
  );

  const summary: ChecksSummary = {
    version: 1,
    coverage: {
      dependencies:
        projects.length === 0 && otherLockfiles.length === 0
          ? "not-applicable"
          : projects.every((p) => auditedDirs.has(path.posix.dirname(p.path) === "." ? "" : path.posix.dirname(p.path))) && otherEcosystems.size === 0
            ? "checked"
            : "unverifiable",
      databaseRules,
    },
    facts,
  };
  return { findings, dependencyFixes, files, summary };
}
