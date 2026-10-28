import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRepoChecks, type ChecksSummary, type CheckFinding } from "@/lib/checks";
import { annotateSiblings } from "@/lib/checks";
import { authedCloneUrl } from "@/lib/worker/process-audit";

export type GuardJobResult = { findings: CheckFinding[]; summary: ChecksSummary; commitSha: string };

/**
 * The push guard's job: clone, check out the pushed commit, and run Boswell's
 * own checks — no AI engine, no cost, a couple of minutes at most. Like a
 * full audit, nothing from the repository is executed.
 */
export async function processGuardJob(input: { cloneUrl: string; githubToken: string; sha: string | null; prNumber: number | null }): Promise<GuardJobResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "boswell-guard-"));
  const repoDir = path.join(workDir, "repo");
  const git = (args: string[], cwd?: string) =>
    execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).toString().trim();
  try {
    git(["clone", "--depth", "50", authedCloneUrl(input.cloneUrl, input.githubToken), repoDir]);
    if (input.sha) {
      try {
        git(["fetch", "--depth", "50", "origin", input.sha], repoDir);
      } catch {
        // Fork PRs: the head commit is reachable through the base repo's pull ref.
        if (input.prNumber === null) throw new Error(`Commit ${input.sha} not found`);
        git(["fetch", "--depth", "50", "origin", `refs/pull/${input.prNumber}/head`], repoDir);
      }
      git(["checkout", "--quiet", "--detach", input.sha], repoDir);
    }
    const commitSha = git(["rev-parse", "HEAD"], repoDir);
    const checks = await runRepoChecks(repoDir, { dependencyAudit: process.env.BOSWELL_DEPENDENCY_AUDIT !== "0" });
    return { findings: annotateSiblings(checks.findings, checks.files), summary: checks.summary, commitSha };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
