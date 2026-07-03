import { spawnSync } from "node:child_process";

function pythonBin() {
  return process.env.BOSWELL_PYTHON ?? "python3";
}

function runPython(args: string[], env: NodeJS.ProcessEnv, timeoutMs?: number) {
  return spawnSync(pythonBin(), args, {
    encoding: "utf8",
    env,
    timeout: timeoutMs,
  });
}

export function installBoswellEngine(engineSpec: string) {
  const env = { ...process.env };

  const pip = runPython(["-m", "pip", "install", "--upgrade", "pip"], env);
  if (pip.status !== 0) {
    throw new Error(`pip upgrade failed: ${pip.stderr || pip.stdout}`);
  }

  const install = runPython(["-m", "pip", "install", "--upgrade", engineSpec], env);
  if (install.status !== 0) {
    throw new Error(
      `Failed to install Boswell engine (${engineSpec}): ${install.stderr || install.stdout}`,
    );
  }

  const verify = runPython(
    ["-c", "import boswell; from boswell.cli import main; print('ok')"],
    env,
  );
  if (verify.status !== 0) {
    throw new Error(`Boswell engine import failed: ${verify.stderr || verify.stdout}`);
  }
}

export function runBoswellEngine(repoDir: string, openRouterKey: string) {
  const script = [
    "import sys",
    `sys.argv = ["boswell", "run", ${JSON.stringify(repoDir)}, "--skip-confirm"]`,
    "from boswell.cli import main",
    "main()",
  ].join("\n");

  const run = runPython(
    ["-c", script],
    { ...process.env, OPENROUTER_API_KEY: openRouterKey },
    20 * 60 * 1000,
  );

  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || "Boswell run failed");
  }
}
