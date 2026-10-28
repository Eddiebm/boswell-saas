import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { gitBlobSha } from "@/lib/checks/npm-audit";
import {
  createDependencyFixPullRequest,
  dependencyPrBody,
  dependencyPrTitle,
  StaleDependencyFixError,
  type DependencyFixRecord,
} from "@/lib/github/dependency-pr";

const originalLock = '{"lockfileVersion":3}\n';
const originalPkg = '{"dependencies":{"next":"15.5.2"}}\n';

const fix: DependencyFixRecord = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  lockfilePath: "package-lock.json",
  baseLockfileBlobSha: gitBlobSha(originalLock),
  patchedLockfile: '{"lockfileVersion":3,"patched":true}\n',
  packageJsonPath: "package.json",
  basePackageJsonBlobSha: gitBlobSha(originalPkg),
  patchedPackageJson: '{"dependencies":{"next":"15.5.9"}}\n',
  pinBumps: [{ name: "next", field: "dependencies", from: "15.5.2", to: "15.5.9" }],
  changes: [
    { name: "next", from: "15.5.2", to: "15.5.9" },
    { name: "@babel/core", from: null, to: "7.29.0" },
  ],
  beforeCounts: { critical: 1, high: 2, moderate: 0, low: 1, total: 4 },
  afterCounts: { critical: 0, high: 0, moderate: 0, low: 1, total: 1 },
};

function mockOctokit(currentShas: Record<string, string>) {
  const rest = {
    git: {
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "head-sha" } } }),
      getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "base-tree" } } }),
      createBlob: vi.fn().mockImplementation(async ({ content }: { content: string }) => ({ data: { sha: `blob-${content.length}` } })),
      createTree: vi.fn().mockResolvedValue({ data: { sha: "new-tree" } }),
      createCommit: vi.fn().mockResolvedValue({ data: { sha: "new-commit" } }),
      createRef: vi.fn().mockResolvedValue({ data: {} }),
    },
    repos: {
      getContent: vi.fn().mockImplementation(async ({ path }: { path: string }) => ({ data: { sha: currentShas[path] } })),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/o/r/pull/9", number: 9 } }),
    },
  };
  return { octokit: { rest } as unknown as Octokit, rest };
}

describe("dependency fix PR", () => {
  it("commits the patched lockfile and package.json to a boswell/deps branch off the default branch", async () => {
    const { octokit, rest } = mockOctokit({ "package-lock.json": fix.baseLockfileBlobSha, "package.json": fix.basePackageJsonBlobSha });
    const result = await createDependencyFixPullRequest({ octokit, owner: "o", repo: "r", defaultBranch: "main", fix });

    expect(result).toMatchObject({ branch: "boswell/deps-0f8fad5bd9cb", prNumber: 9 });
    expect(rest.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        base_tree: "base-tree",
        tree: [
          expect.objectContaining({ path: "package-lock.json", mode: "100644" }),
          expect.objectContaining({ path: "package.json", mode: "100644" }),
        ],
      }),
    );
    expect(rest.git.createCommit).toHaveBeenCalledWith(expect.objectContaining({ parents: ["head-sha"] }));
    expect(rest.git.createRef).toHaveBeenCalledWith(expect.objectContaining({ ref: "refs/heads/boswell/deps-0f8fad5bd9cb", sha: "new-commit" }));
    expect(rest.pulls.create).toHaveBeenCalledWith(expect.objectContaining({ base: "main", head: "boswell/deps-0f8fad5bd9cb" }));
  });

  it("refuses to open a PR when the lockfile changed since the audit", async () => {
    const { octokit, rest } = mockOctokit({ "package-lock.json": "someone-else-pushed", "package.json": fix.basePackageJsonBlobSha });
    await expect(createDependencyFixPullRequest({ octokit, owner: "o", repo: "r", defaultBranch: "main", fix })).rejects.toBeInstanceOf(StaleDependencyFixError);
    expect(rest.git.createBlob).not.toHaveBeenCalled();
    expect(rest.git.createRef).not.toHaveBeenCalled();
  });

  it("refuses a lockfile-only fix when package.json changed since the audit", async () => {
    const { octokit, rest } = mockOctokit({ "package-lock.json": fix.baseLockfileBlobSha, "package.json": "narrowed-a-range" });
    const lockfileOnly = { ...fix, patchedPackageJson: null, pinBumps: [] };
    await expect(createDependencyFixPullRequest({ octokit, owner: "o", repo: "r", defaultBranch: "main", fix: lockfileOnly })).rejects.toBeInstanceOf(StaleDependencyFixError);
    expect(rest.git.createBlob).not.toHaveBeenCalled();
  });

  it("only writes package.json when a pin was raised", async () => {
    const { octokit, rest } = mockOctokit({ "package-lock.json": fix.baseLockfileBlobSha, "package.json": fix.basePackageJsonBlobSha });
    await createDependencyFixPullRequest({ octokit, owner: "o", repo: "r", defaultBranch: "main", fix: { ...fix, patchedPackageJson: null, pinBumps: [] } });
    expect(rest.git.createBlob).toHaveBeenCalledTimes(1);
  });

  it("explains what changed and that the repo's CI is the verification", () => {
    expect(dependencyPrTitle(fix)).toBe("Boswell: fix 3 vulnerable dependencies");
    const body = dependencyPrBody(fix);
    expect(body).toContain("**Advisories before:** 1 critical, 2 high, 1 low");
    expect(body).toContain("**Advisories after:** 1 low");
    expect(body).toContain("`next`: `15.5.2` → `15.5.9`");
    expect(body).toContain("| `next` | 15.5.2 | 15.5.9 |");
    expect(body).toContain("did not install, build, or run any of this repository's code");
  });
});
