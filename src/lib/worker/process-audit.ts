import { parseAuditMarkdown, parseLeakMetadata } from "@/lib/parsers/audit-parser";
import { scanAiSlop, type SlopResult } from "@/lib/slop/engine";
import type { ScoreInput } from "@/lib/scoring/types";
import { installBoswellEngine, runBoswellEngine } from "@/lib/worker/boswell-engine";
import { execFileSync } from "node:child_process";
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
  lineStart?: number;
  recommendation?: string;
};

export type ProcessAuditResult = {
  documents: Record<string, string>;
  findings: ProcessedFinding[];
  stack: string[];
  slop: SlopResult;
  scoreInput: ScoreInput;
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

function walkSourceFiles(repoDir: string) {
  const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
  const skip = new Set(["node_modules", ".git", ".next", "dist", "build"]);
  const out: Array<{ path: string; content: string; lines: number }> = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.has(path.extname(entry.name))) {
        try {
          const content = fs.readFileSync(full, "utf8");
          out.push({
            path: path.relative(repoDir, full),
            content,
            lines: content.split("\n").length,
          });
        } catch {
          /* skip */
        }
      }
    }
  }

  walk(repoDir);
  return out;
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
      ["clone", "--depth", "50", authedCloneUrl(input.cloneUrl, input.githubToken), repoDir],
      { stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );

    installBoswellEngine(engineSpec);
    runBoswellEngine(repoDir, openRouterKey);

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

    const leakRaw = fs.existsSync(metadataPath)
      ? (JSON.parse(fs.readFileSync(metadataPath, "utf8")) as { leak_findings?: unknown[] }).leak_findings ?? []
      : [];
    const leakFindings = parseLeakMetadata(leakRaw as Parameters<typeof parseLeakMetadata>[0]);
    const auditFindings = parseAuditMarkdown(audit).map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      filePath: f.filePath,
      lineStart: f.lineStart,
    }));
    const merged = [...leakFindings, ...auditFindings].slice(0, 100).map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      filePath: f.filePath,
      lineStart: f.lineStart,
      recommendation: "recommendation" in f ? (f as { recommendation?: string }).recommendation : undefined,
    }));

    const slopFiles = walkSourceFiles(repoDir).slice(0, 200);
    const slop = scanAiSlop({ files: slopFiles });

    const critical = merged.filter((f) => f.severity === "CRITICAL").length;
    const high = merged.filter((f) => f.severity === "HIGH").length;
    const medium = merged.filter((f) => f.severity === "MEDIUM").length;

    const scoreInput: ScoreInput = {
      criticalFindings: critical,
      highFindings: high,
      mediumFindings: medium,
      giantFiles: slopFiles.filter((f) => f.lines > 400).length,
      circularDeps: 0,
      depCount: stack.length,
      missingLockfile: !fs.existsSync(path.join(repoDir, "package-lock.json")),
      hasReadme: fs.existsSync(path.join(repoDir, "README.md")),
      hasTests: slopFiles.some((f) => f.path.includes("test") || f.path.includes("spec")),
      testFileCount: slopFiles.filter((f) => /\.(test|spec)\./.test(f.path)).length,
      sourceFileCount: slopFiles.length,
      avgFileLines: slopFiles.length
        ? Math.round(slopFiles.reduce((s, f) => s + f.lines, 0) / slopFiles.length)
        : 0,
      maxFileLines: slopFiles.reduce((m, f) => Math.max(m, f.lines), 0),
      slopPercent: slop.overallPercent,
      deployVerdict: extractVerdict(audit),
    };

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
      slop,
      scoreInput,
      costUsd,
      summary: `Audit completed for ${input.repoFullName}`,
      deployVerdict: extractVerdict(audit),
      topRisk: extractTopRisk(audit),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
