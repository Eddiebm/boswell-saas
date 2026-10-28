import semver from "semver";
import type { CheckFinding } from "@/lib/checks/types";

type PackageJson = Record<string, unknown> & {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type Lockfile = {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string } & Record<string, unknown>>;
  dependencies?: Record<string, unknown>;
};

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export type DriftInput = {
  /** Directory of the package.json, relative to the repo root ("" for the root). */
  dir: string;
  packageJson: string;
  /** Contents of the sibling package-lock.json, or null if there isn't one. */
  lockfile: string | null;
  /** Names of any yarn/pnpm/bun lockfiles beside it — those projects aren't npm's to judge. */
  otherLockfiles: string[];
};

function at(dir: string, file: string) {
  return dir ? `${dir}/${file}` : file;
}

/**
 * Whether npm would accept the locked version for this spec. Only plain
 * semver ranges can be judged; tags, git URLs, aliases and local paths are
 * given the benefit of the doubt.
 */
function satisfiesSpec(version: string | undefined, spec: string): boolean {
  if (!version) return false;
  const range = semver.validRange(spec, { loose: true });
  if (range === null) return true;
  return semver.satisfies(version, range, { includePrerelease: true, loose: true });
}

/**
 * `npm ci` refuses to install when package.json and package-lock.json disagree,
 * which breaks every clean install and CI run — and until someone notices, the
 * lockfile is no longer pinning what actually gets installed.
 */
export function checkLockfileDrift(input: DriftInput): CheckFinding[] {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(input.packageJson);
  } catch {
    return [];
  }

  const declared = new Map<string, { field: string; spec: string }>();
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) declared.set(name, { field, spec });
  }
  if (declared.size === 0) return [];

  if (input.lockfile === null) {
    if (input.otherLockfiles.length > 0) return [];
    return [
      {
        severity: "LOW",
        category: "dependencies",
        title: "No lockfile: installs aren't reproducible",
        description: `${at(input.dir, "package.json")} declares ${declared.size} dependencies but there's no package-lock.json (or yarn/pnpm lockfile) beside it, so every install can resolve different versions — including newly published vulnerable ones.`,
        filePath: at(input.dir, "package.json"),
        recommendation: "Run `npm install` and commit the generated package-lock.json.",
        confidence: 0.9,
      },
    ];
  }

  let lock: Lockfile;
  try {
    lock = JSON.parse(input.lockfile);
  } catch {
    return [
      {
        severity: "MEDIUM",
        category: "dependencies",
        title: "package-lock.json is not valid JSON",
        description: `${at(input.dir, "package-lock.json")} can't be parsed, so \`npm ci\` will fail. This usually means a merge conflict was committed unresolved.`,
        filePath: at(input.dir, "package-lock.json"),
        recommendation: "Resolve the conflict markers, or delete the lockfile and regenerate it with `npm install`.",
        confidence: 0.95,
      },
    ];
  }

  // Blocking: what npm ci itself rejects (a declared dependency with no locked version that satisfies it).
  // Stale: the lockfile's record of package.json is out of date, but every install still resolves correctly.
  const problems: string[] = [];
  const stale: string[] = [];
  const root = lock.packages?.[""] as (Record<string, Record<string, string> | undefined>) | undefined;

  if (root) {
    const locked = new Map<string, string>();
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(root[field] ?? {})) locked.set(name, spec);
    }
    for (const [name, { spec }] of declared) {
      const lockedSpec = locked.get(name);
      const resolved = lock.packages?.[`node_modules/${name}`]?.version;
      if (lockedSpec === undefined) problems.push(`\`${name}\` is in package.json but missing from the lockfile`);
      else if (!resolved) problems.push(`\`${name}\` has no resolved version in the lockfile`);
      else if (!satisfiesSpec(resolved, spec)) problems.push(`\`${name}\` is \`${spec}\` in package.json but the lockfile resolves ${resolved}`);
      else if (lockedSpec !== spec) stale.push(`\`${name}\` is \`${spec}\` in package.json but recorded as \`${lockedSpec}\` in the lockfile (the locked ${resolved} still fits)`);
    }
    for (const name of locked.keys()) {
      if (!declared.has(name)) stale.push(`\`${name}\` is in the lockfile but was removed from package.json`);
    }
  } else if (lock.dependencies) {
    // lockfileVersion 1: no record of the declared specs, only resolved packages.
    for (const name of declared.keys()) {
      if (!(name in lock.dependencies)) problems.push(`\`${name}\` is in package.json but missing from the lockfile`);
    }
  }

  const where = input.dir ? `\`${input.dir}\`` : "this project";
  if (problems.length === 0) {
    if (stale.length === 0) return [];
    return [
      {
        severity: "INFO",
        category: "dependencies",
        title: "package-lock.json is out of date with package.json",
        description: [
          `Installs of ${where} still work — every locked version satisfies package.json — but the lockfile's record of it is stale, so the next \`npm install\` will rewrite it in an unrelated change:`,
          "",
          ...stale.slice(0, 8).map((p) => `- ${p}`),
          ...(stale.length > 8 ? [`- …and ${stale.length - 8} more`] : []),
        ].join("\n"),
        filePath: at(input.dir, "package-lock.json"),
        recommendation: "Run `npm install` in this directory and commit the updated package-lock.json.",
        confidence: 0.9,
      },
    ];
  }

  const shown = problems.slice(0, 8);
  const more = problems.length - shown.length;
  return [
    {
      severity: "MEDIUM",
      category: "dependencies",
      title: "package.json and package-lock.json are out of sync",
      description: [
        `\`npm ci\` will refuse to install ${where}, so clean installs and any CI that uses it fail — and the lockfile no longer pins what \`npm install\` actually resolves.`,
        "",
        ...shown.map((p) => `- ${p}`),
        ...(more > 0 ? [`- …and ${more} more`] : []),
      ].join("\n"),
      filePath: at(input.dir, "package-lock.json"),
      recommendation: "Run `npm install` in this directory and commit the updated package-lock.json. Boswell's dependency fix PR does this automatically.",
      confidence: 0.95,
    },
  ];
}
