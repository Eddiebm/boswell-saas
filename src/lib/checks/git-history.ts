import { execFile } from "node:child_process";
import { isEnvExample, isTestFile } from "@/lib/checks/collect-files";
import { findSecrets, maskSecret } from "@/lib/checks/hardcoded-secrets";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

const MAX_COMMITS = 50;
const MAX_OUTPUT = 32 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export type GitLog = (repoDir: string) => Promise<string>;

/**
 * `git log -p` of recent commits, run without a shell, with external diff
 * drivers and textconv disabled (so a repo's .gitattributes can't make git
 * execute anything), and with none of the worker's environment.
 */
export const defaultGitLog: GitLog = (repoDir) =>
  new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: repoDir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    };
    execFile(
      "git",
      ["-C", repoDir, "log", "-p", `-n${MAX_COMMITS}`, "--no-color", "--no-ext-diff", "--no-textconv", "--diff-filter=AM", "-U0", "--format=commit:%H %ad", "--date=short"],
      {
        env: env as NodeJS.ProcessEnv,
        maxBuffer: MAX_OUTPUT,
        timeout: TIMEOUT_MS,
      },
      (error, stdout) => (error && !stdout ? reject(error) : resolve(String(stdout))),
    );
  });

type Addition = { commit: string; date: string; file: string; text: string };

export function parseAddedLines(log: string): Addition[] {
  const out = new Map<string, Addition>();
  let commit = "";
  let date = "";
  let file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit:")) {
      [commit, date] = line.slice(7).split(" ");
      file = "";
    } else if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : "";
    } else if (file && line.startsWith("+") && !line.startsWith("+++")) {
      const key = `${commit}:${file}`;
      const entry = out.get(key) ?? { commit, date, file, text: "" };
      entry.text += line.slice(1) + "\n";
      out.set(key, entry);
    }
  }
  return [...out.values()];
}

/**
 * Keys committed in recent history but no longer in the code. Deleting a key
 * doesn't revoke it — anyone with a clone or the GitHub history still has
 * it — so these get the same severity as a key in the current code.
 */
export async function checkGitHistorySecrets(repoDir: string, files: RepoFile[], gitLog: GitLog = defaultGitLog): Promise<CheckFinding[]> {
  let log: string;
  try {
    log = await gitLog(repoDir);
  } catch {
    return [];
  }

  // Keys still in the working tree are already reported by the current-code scan.
  const current = new Set(files.flatMap((f) => findSecrets(f.content).map((h) => h.value)));
  const seen = new Set<string>();
  const out: CheckFinding[] = [];

  for (const add of parseAddedLines(log)) {
    const pseudo = { path: add.file, content: add.text };
    if (isTestFile(pseudo) || isEnvExample(pseudo)) continue;
    for (const hit of findSecrets(add.text)) {
      if (current.has(hit.value) || seen.has(hit.value)) continue;
      seen.add(hit.value);
      out.push({
        ruleId: "secrets.history",
        severity: "CRITICAL",
        category: "secrets",
        title: `${hit.name[0].toUpperCase()}${hit.name.slice(1)} in git history`,
        description: `Commit \`${add.commit.slice(0, 7)}\` (${add.date}) added what looks like a live ${hit.name} (\`${maskSecret(hit.value)}\`) to \`${add.file}\`. It's no longer in the code, but it's still in the repository's history — anyone with a clone, a fork, or access to GitHub can read it.`,
        filePath: add.file,
        recommendation: `Rotate it now (${hit.rotate}). Rewriting history doesn't help once it's been pushed — rotating the key is the fix.`,
        confidence: 0.85,
      });
      if (out.length >= 10) return out;
    }
  }
  return out;
}
