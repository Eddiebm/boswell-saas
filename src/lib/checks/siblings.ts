import type { RepoFile } from "@/lib/checks/types";

type Locatable = { filePath?: string; lineStart?: number; description: string };

const MIN_LENGTH = 30;
const MAX_SIBLINGS = 5;
/** Lines that repeat everywhere for structural reasons, not because they were copied. */
const BOILERPLATE = /^(?:import\b|export\s+(?:\*|\{)|\}|\)|return\s*;|["']use (?:client|server)["'];?$|\/\/|\*|#)/;

function normalize(line: string) {
  return line.trim().replace(/\s+/g, " ");
}

/**
 * Bugs come in pairs: code gets copied, and the bug goes with it. For each
 * finding that points at a line, look for the same line in other files and
 * say where — so fixing one copy doesn't leave the others behind.
 *
 * Only exact (whitespace-normalised) matches of substantial lines count,
 * and a line found in more than a handful of files is treated as a common
 * idiom rather than a copy.
 */
export function annotateSiblings<T extends Locatable>(findings: T[], files: RepoFile[]): T[] {
  const lines = new Map<string, string[]>();
  for (const f of files) lines.set(f.path, f.content.split("\n"));

  const index = new Map<string, Array<{ file: string; line: number }>>();
  const wanted = new Set<string>();
  for (const finding of findings) {
    if (!finding.filePath || !finding.lineStart) continue;
    const text = lines.get(finding.filePath)?.[finding.lineStart - 1];
    if (!text) continue;
    const norm = normalize(text);
    if (norm.length >= MIN_LENGTH && !BOILERPLATE.test(norm)) wanted.add(norm);
  }
  if (wanted.size === 0) return findings;

  for (const [file, content] of lines) {
    content.forEach((text, i) => {
      const norm = normalize(text);
      if (!wanted.has(norm)) return;
      index.set(norm, [...(index.get(norm) ?? []), { file, line: i + 1 }]);
    });
  }

  return findings.map((finding) => {
    if (!finding.filePath || !finding.lineStart) return finding;
    const text = lines.get(finding.filePath)?.[finding.lineStart - 1];
    if (!text) return finding;
    const matches = (index.get(normalize(text)) ?? []).filter((m) => m.file !== finding.filePath);
    const otherFiles = new Set(matches.map((m) => m.file));
    if (otherFiles.size === 0 || otherFiles.size > MAX_SIBLINGS) return finding;
    const where = matches.slice(0, MAX_SIBLINGS).map((m) => `${m.file}:${m.line}`).join(", ");
    return {
      ...finding,
      description: `${finding.description}\n\nThe same line also appears in ${where}. If it's a copy, it likely has the same problem — fix ${matches.length === 1 ? "both" : "all of them"} together.`,
    };
  });
}
