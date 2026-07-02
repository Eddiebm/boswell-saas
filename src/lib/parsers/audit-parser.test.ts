import { describe, expect, it } from "vitest";
import { parseAuditMarkdown, parseLeakMetadata } from "@/lib/parsers/audit-parser";

describe("parseAuditMarkdown", () => {
  it("extracts severities and file paths", () => {
    const md = `
- **[HIGH]** \`src/auth.ts:42\` — missing validation
- **[MEDIUM]** generic issue without path
`;
    const findings = parseAuditMarkdown(md);
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].filePath).toBe("src/auth.ts");
    expect(findings[0].lineStart).toBe(42);
  });
});

describe("parseLeakMetadata", () => {
  it("maps leak findings to parsed shape", () => {
    const out = parseLeakMetadata([
      {
        severity: "CRITICAL",
        category: "tracked-env-file",
        description: ".env tracked",
        location: ".env",
        fix: "git rm --cached .env",
      },
    ]);
    expect(out[0].severity).toBe("CRITICAL");
    expect(out[0].filePath).toBe(".env");
  });
});
