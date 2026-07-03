import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AuditMode } from "@/lib/audit-modes";
import { normalizeAuditMode } from "@/lib/audit-modes";

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

const RUNNER_SCRIPT = path.join(process.cwd(), "scripts", "boswell-run-audit.py");

export function installBoswellEngine(engineSpec: string) {
  if (process.env.BOSWELL_SKIP_ENGINE_INSTALL === "1") {
    const verify = runPython(["-c", "import boswell; print('ok')"], process.env);
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

  const verify = runPython(["-c", "import boswell; print('ok')"], env);
  if (verify.status !== 0) {
    throw new Error(`Boswell engine import failed: ${verify.stderr || verify.stdout}`);
  }
}

export function runBoswellEngine(
  repoDir: string,
  openRouterKey: string,
  auditMode: AuditMode = "standard",
) {
  const mode = normalizeAuditMode(auditMode);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENROUTER_API_KEY: openRouterKey,
    BOSWELL_AUDIT_MODE: mode,
    BOSWELL_MIN_AUDIT_CHARS: String(MIN_AUDIT_CHARS),
    PYTHONUNBUFFERED: "1",
  };

  const run = runPython([RUNNER_SCRIPT, repoDir], env, 25 * 60 * 1000);

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

  return { stdout, stderr, mode };
}
