import type { Octokit } from "@octokit/rest";

export type DependencyFixRecord = {
  id: string;
  lockfilePath: string;
  baseLockfileBlobSha: string;
  patchedLockfile: string;
  packageJsonPath: string;
  basePackageJsonBlobSha: string;
  patchedPackageJson: string | null;
  pinBumps: Array<{ name: string; field: string; from: string; to: string }>;
  changes: Array<{ name: string; from: string | null; to: string | null }>;
  beforeCounts: Record<string, number> | null;
  afterCounts: Record<string, number> | null;
};

export class StaleDependencyFixError extends Error {
  constructor(path: string) {
    super(`${path} has changed on the default branch since this audit. Re-run the audit so Boswell patches the current version.`);
    this.name = "StaleDependencyFixError";
  }
}

const SEVERITIES = ["critical", "high", "moderate", "low"] as const;

function countLine(counts: Record<string, number> | null) {
  if (!counts) return "unknown";
  const parts = SEVERITIES.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
  return parts.length ? parts.join(", ") : "none";
}

export function dependencyPrTitle(fix: DependencyFixRecord) {
  const fixed = (fix.beforeCounts?.total ?? 0) - (fix.afterCounts?.total ?? 0);
  const where = fix.lockfilePath === "package-lock.json" ? "" : ` in ${fix.lockfilePath.replace(/\/package-lock\.json$/, "")}`;
  return fixed > 0
    ? `Boswell: fix ${fixed} vulnerable ${fixed === 1 ? "dependency" : "dependencies"}${where}`
    : `Boswell: resync package-lock.json${where}`;
}

export function dependencyPrBody(fix: DependencyFixRecord) {
  const updated = fix.changes.filter((c) => c.from && c.to);
  const added = fix.changes.filter((c) => !c.from && c.to);
  const removed = fix.changes.filter((c) => c.from && !c.to);
  const shown = updated.slice(0, 40);
  return [
    "Boswell found known vulnerabilities in this project's dependencies and patched the lockfile with the non-breaking fixes only.",
    "",
    `**Advisories before:** ${countLine(fix.beforeCounts)}`,
    `**Advisories after:** ${countLine(fix.afterCounts)}`,
    "",
    ...(fix.pinBumps.length
      ? [
          "### package.json pins raised",
          "These direct dependencies were pinned below their patched release. Each bump stays within the same major version.",
          "",
          ...fix.pinBumps.map((b) => `- \`${b.name}\`: \`${b.from}\` → \`${b.to}\``),
          "",
        ]
      : []),
    `### Lockfile changes (${updated.length} updated, ${added.length} added, ${removed.length} removed)`,
    ...(shown.length ? ["", "| Package | From | To |", "| --- | --- | --- |", ...shown.map((c) => `| \`${c.name}\` | ${c.from} | ${c.to} |`)] : []),
    ...(updated.length > shown.length ? ["", `…and ${updated.length - shown.length} more.`] : []),
    "",
    "### How this was made",
    "- `npm audit fix --package-lock-only --ignore-scripts` on a copy of `package.json` and `package-lock.json` only, against the public npm registry.",
    "- Boswell did not install, build, or run any of this repository's code or scripts. **Your CI on this PR is the verification** — merge only once it's green.",
    "- Fixes that need a major-version upgrade are not included; they're listed in the Boswell audit as planned upgrades.",
    "",
    "### Rollback",
    "Close this PR, or revert its merge commit. Nothing outside the files in this diff was changed.",
    "",
    "---",
    "*Opened by [Boswell](https://boswell-saas.vercel.app). Never auto-merged.*",
  ].join("\n");
}

type FileUpdate = { path: string; baseBlobSha: string; content: string };

async function currentBlobSha(octokit: Octokit, owner: string, repo: string, path: string, ref: string) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    return Array.isArray(data) ? null : data.sha;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/**
 * Commits the patched lockfile (and package.json, if pins were raised) to a
 * new `boswell/deps-*` branch with the git data API — so multi-megabyte
 * lockfiles work — and opens a PR. Refuses if either file on the default
 * branch differs from the one the patch was computed from.
 */
export async function createDependencyFixPullRequest(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  defaultBranch: string;
  fix: DependencyFixRecord;
}) {
  const { octokit, owner, repo, fix } = input;
  const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${input.defaultBranch}` });
  const headSha = baseRef.object.sha;

  // The patch was computed from both files, so both must be unchanged — even when only the lockfile is written.
  const sources = [
    { path: fix.lockfilePath, baseBlobSha: fix.baseLockfileBlobSha },
    { path: fix.packageJsonPath, baseBlobSha: fix.basePackageJsonBlobSha },
  ];
  for (const source of sources) {
    if ((await currentBlobSha(octokit, owner, repo, source.path, headSha)) !== source.baseBlobSha) throw new StaleDependencyFixError(source.path);
  }

  const updates: FileUpdate[] = [{ path: fix.lockfilePath, baseBlobSha: fix.baseLockfileBlobSha, content: fix.patchedLockfile }];
  if (fix.patchedPackageJson) updates.push({ path: fix.packageJsonPath, baseBlobSha: fix.basePackageJsonBlobSha, content: fix.patchedPackageJson });

  const { data: headCommit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: headSha });
  const tree = [];
  for (const u of updates) {
    const { data: blob } = await octokit.rest.git.createBlob({ owner, repo, content: Buffer.from(u.content, "utf8").toString("base64"), encoding: "base64" });
    tree.push({ path: u.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
  }
  const { data: newTree } = await octokit.rest.git.createTree({ owner, repo, base_tree: headCommit.tree.sha, tree });

  const title = dependencyPrTitle(fix);
  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `${title}\n\nnpm audit fix --package-lock-only (non-breaking fixes only), prepared by Boswell.`,
    tree: newTree.sha,
    parents: [headSha],
  });

  const branch = `boswell/deps-${fix.id.replace(/-/g, "").slice(0, 12)}`;
  await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha });

  const { data: pr } = await octokit.rest.pulls.create({ owner, repo, head: branch, base: input.defaultBranch, title, body: dependencyPrBody(fix) });
  return { branch, title, prUrl: pr.html_url, prNumber: pr.number };
}
