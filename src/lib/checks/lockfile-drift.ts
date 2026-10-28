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

  const problems: string[] = [];
  const root = lock.packages?.[""] as (Record<string, Record<string, string> | undefined>) | undefined;

  if (root) {
    const locked = new Map<string, string>();
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(root[field] ?? {})) locked.set(name, spec);
    }
    for (const [name, { spec }] of declared) {
      const lockedSpec = locked.get(name);
      if (lockedSpec === undefined) problems.push(`\`${name}\` is in package.json but missing from the lockfile`);
      else if (lockedSpec !== spec) problems.push(`\`${name}\` is \`${spec}\` in package.json but \`${lockedSpec}\` in the lockfile`);
      else if (!lock.packages?.[`node_modules/${name}`]) problems.push(`\`${name}\` has no resolved version in the lockfile`);
    }
    for (const name of locked.keys()) {
      if (!declared.has(name)) problems.push(`\`${name}\` is in the lockfile but was removed from package.json`);
    }
  } else if (lock.dependencies) {
    // lockfileVersion 1: no record of the declared specs, only resolved packages.
    for (const name of declared.keys()) {
      if (!(name in lock.dependencies)) problems.push(`\`${name}\` is in package.json but missing from the lockfile`);
    }
  }

  if (problems.length === 0) return [];

  const shown = problems.slice(0, 8);
  const more = problems.length - shown.length;
  const where = input.dir ? `\`${input.dir}\`` : "this project";
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
