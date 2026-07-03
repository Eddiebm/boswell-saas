import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MIN_AUDIT_CHARS = 200;

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
  if (process.env.BOSWELL_SKIP_ENGINE_INSTALL === "1") {
    const verify = runPython(
      ["-c", "import boswell; from boswell.cli import _run_single_repo; print('ok')"],
      process.env,
    );
    if (verify.status !== 0) {
      throw new Error(`Boswell engine import failed: ${verify.stderr || verify.stdout}`);
    }
    return;
  }

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
    ["-c", "import boswell; from boswell.cli import _run_single_repo; print('ok')"],
    env,
  );
  if (verify.status !== 0) {
    throw new Error(`Boswell engine import failed: ${verify.stderr || verify.stdout}`);
  }
}

function engineRunScript(repoDir: string) {
  return [
    "import json, os, sys",
    "from pathlib import Path",
    "from boswell.cli import _run_single_repo",
    "",
    `repo = Path(${JSON.stringify(repoDir)})`,
    'api_key = os.environ.get("OPENROUTER_API_KEY", "")',
    'if not api_key:',
    '    print(json.dumps({"ok": False, "error": "OPENROUTER_API_KEY is not set"}))',
    "    sys.exit(1)",
    "",
    "result = _run_single_repo(",
    "    repo_path=repo,",
    "    api_key=api_key,",
    "    skip_confirm=True,",
    "    prompt_context=False,",
    ")",
    "",
    'if result.get("error"):',
    '    print(json.dumps({"ok": False, "error": result["error"], "result": result}))',
    "    sys.exit(1)",
    "",
    'audit_path = repo / ".boswell" / "audit.md"',
    "if not audit_path.exists():",
    '    print(json.dumps({"ok": False, "error": "Boswell did not write .boswell/audit.md", "result": result}))',
    "    sys.exit(1)",
    "",
    'audit_text = audit_path.read_text(encoding="utf-8")',
    `if len(audit_text.strip()) < ${MIN_AUDIT_CHARS}:`,
    '    print(json.dumps({"ok": False, "error": f"audit.md too short ({len(audit_text)} chars)", "result": result}))',
    "    sys.exit(1)",
    "",
    'print(json.dumps({"ok": True, "result": result}))',
  ].join("\n");
}

export function runBoswellEngine(repoDir: string, openRouterKey: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENROUTER_API_KEY: openRouterKey,
    PYTHONUNBUFFERED: "1",
  };

  const run = runPython(["-c", engineRunScript(repoDir)], env, 25 * 60 * 1000);

  const stdout = run.stdout?.trim() ?? "";
  const stderr = run.stderr?.trim() ?? "";

  if (run.status !== 0) {
    const detail = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(detail || "Boswell engine run failed");
  }

  const auditPath = path.join(repoDir, ".boswell", "audit.md");
  if (!fs.existsSync(auditPath)) {
    throw new Error(
      `Boswell did not produce audit.md after a successful exit.\n${stderr}\n${stdout}`,
    );
  }

  const auditText = fs.readFileSync(auditPath, "utf8");
  if (auditText.trim().length < MIN_AUDIT_CHARS) {
    throw new Error(
      `Boswell audit.md is too short (${auditText.length} chars).\n${stderr}\n${stdout}`,
    );
  }

  return { stdout, stderr };
}
