import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ProcessedFinding = {
  severity: Severity;
  category: string;
  title: string;
  description: string;
  filePath?: string;
  lineNumber?: number;
  recommendation?: string;
};

export type ProcessAuditResult = {
  documents: Record<string, string>;
  findings: ProcessedFinding[];
  stack: string[];
  costUsd?: number;
  summary?: string;
  deployVerdict?: string;
  topRisk?: string;
};

function authedCloneUrl(cloneUrl: string, token: string) {
  if (!cloneUrl.startsWith("https://github.com/")) {
    return cloneUrl;
  }
  return cloneUrl.replace("https://github.com/", `https://x-access-token:${token}@github.com/`);
}

function readIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function parseLeakFindings(metadataPath: string): ProcessedFinding[] {
  if (!fs.existsSync(metadataPath)) return [];
  const meta = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
    leak_findings?: Array<{
      severity: Severity;
      category: string;
      description: string;
      location?: string;
      fix?: string;
    }>;
  };

  return (meta.leak_findings ?? []).map((f) => {
    const lineMatch = f.location?.match(/:(\d+)$/);
    const filePath = f.location?.replace(/:\d+$/, "").replace(/^commit [^/]+\s+\/\s+/, "");
    return {
      severity: f.severity,
      category: f.category,
      title: f.description.slice(0, 120),
      description: f.description,
      filePath: filePath || undefined,
      lineNumber: lineMatch ? Number(lineMatch[1]) : undefined,
      recommendation: f.fix,
    };
  });
}

function parseAuditMarkdownFindings(auditText: string): ProcessedFinding[] {
  const out: ProcessedFinding[] = [];
  for (const line of auditText.split("\n")) {
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
      if (!line.includes(`[${severity}]`)) continue;
      const title = line.replace(/^[\s\-*]+/, "").slice(0, 160);
      out.push({
        severity,
        category: "audit",
        title,
        description: line.trim(),
      });
      break;
    }
  }
  return out.slice(0, 50);
}

function extractVerdict(auditText: string) {
  for (const line of auditText.split("\n")) {
    const low = line.toLowerCase();
    if (low.includes("could deploy tomorrow")) return "Could deploy tomorrow";
    if (low.includes("do not deploy") || low.includes("don't deploy")) return "Do not deploy";
  }
  return undefined;
}

function extractTopRisk(auditText: string) {
  for (const line of auditText.split("\n")) {
    if (line.includes("[CRITICAL]") || line.includes("[HIGH]")) {
      return line.trim().slice(0, 120);
    }
  }
  return undefined;
}

export async function processAuditJob(input: {
  cloneUrl: string;
  githubToken: string;
  repoFullName: string;
}): Promise<ProcessAuditResult> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the worker");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "boswell-"));
  const repoDir = path.join(workDir, "repo");
  const engineSpec =
    process.env.BOSWELL_ENGINE_GIT_URL ??
    "git+https://github.com/Eddiebm/boswell.git";

  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", authedCloneUrl(input.cloneUrl, input.githubToken), repoDir],
      { stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );

    spawnSync("python3", ["-m", "pip", "install", engineSpec], {
      stdio: "pipe",
      env: process.env,
    });

    const run = spawnSync(
      "boswell",
      ["run", repoDir, "--skip-confirm"],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          OPENROUTER_API_KEY: openRouterKey,
        },
        encoding: "utf8",
        timeout: 20 * 60 * 1000,
      },
    );

    if (run.status !== 0) {
      throw new Error(run.stderr || run.stdout || "Boswell run failed");
    }

    const boswellDir = path.join(repoDir, ".boswell");
    const audit = readIfExists(path.join(boswellDir, "audit.md"));
    const handoff = readIfExists(path.join(boswellDir, "handoff.md"));
    const auditSimple = readIfExists(path.join(boswellDir, "audit-simple.md"));
    const handoffSimple = readIfExists(path.join(boswellDir, "handoff-simple.md"));
    const lessons = readIfExists(path.join(boswellDir, "lessons.md"));
    const metadataPath = path.join(boswellDir, "metadata.json");

    let stack: string[] = [];
    let costUsd: number | undefined;
    if (fs.existsSync(metadataPath)) {
      const meta = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
        stack?: string[];
        cost_usd?: number;
      };
      stack = meta.stack ?? [];
      costUsd = meta.cost_usd;
    }

    const leakFindings = parseLeakFindings(metadataPath);
    const auditFindings = parseAuditMarkdownFindings(audit);
    const merged = [...leakFindings, ...auditFindings].slice(0, 100);

    return {
      documents: {
        audit,
        handoff,
        "audit-simple": auditSimple,
        "handoff-simple": handoffSimple,
        lessons,
      },
      findings: merged,
      stack,
      costUsd,
      summary: `Audit completed for ${input.repoFullName}`,
      deployVerdict: extractVerdict(audit),
      topRisk: extractTopRisk(audit),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
