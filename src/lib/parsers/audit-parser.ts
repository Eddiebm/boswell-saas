export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ParsedFinding = {
  title: string;
  description: string;
  severity: FindingSeverity;
  category: string;
  filePath?: string;
  lineStart?: number;
};

const SEVERITIES: FindingSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export function parseAuditMarkdown(auditMd: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];

  for (const line of auditMd.split("\n")) {
    const stripped = line.trim().replace(/^[-*]\s*/, "");
    for (const severity of SEVERITIES) {
      if (!stripped.includes(`[${severity}]`)) continue;

      const pathMatch = stripped.match(/`([^`]+\.[a-z]{1,4})(?::(\d+))?`/i);
      findings.push({
        title: stripped.replace(/\*\*/g, "").slice(0, 160),
        description: stripped,
        severity,
        category: inferCategory(stripped),
        filePath: pathMatch?.[1],
        lineStart: pathMatch?.[2] ? Number(pathMatch[2]) : undefined,
      });
      break;
    }
  }

  return dedupe(findings);
}

export function parseLeakMetadata(
  leakFindings: Array<{
    severity: FindingSeverity;
    category: string;
    description: string;
    location?: string;
    fix?: string;
  }>,
): ParsedFinding[] {
  return leakFindings.map((f) => {
    const lineMatch = f.location?.match(/:(\d+)$/);
    const filePath = f.location?.replace(/:(\d+)$/, "").replace(/^commit [^/]+\s+\/\s+/, "");
    return {
      title: f.description.slice(0, 160),
      description: f.description,
      severity: f.severity,
      category: f.category,
      filePath: filePath || undefined,
      lineStart: lineMatch ? Number(lineMatch[1]) : undefined,
    };
  });
}

function inferCategory(text: string): string {
  const low = text.toLowerCase();
  if (low.includes("secret") || low.includes("credential") || low.includes("api key")) return "security";
  if (low.includes("auth")) return "auth";
  if (low.includes("sql") || low.includes("inject")) return "injection";
  if (low.includes("test")) return "testing";
  if (low.includes("document") || low.includes("readme")) return "documentation";
  if (low.includes("depend")) return "dependencies";
  if (low.includes("duplicate")) return "duplicate";
  return "audit";
}

function dedupe(items: ParsedFinding[]): ParsedFinding[] {
  const seen = new Set<string>();
  return items.filter((f) => {
    const key = `${f.severity}:${f.title.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
