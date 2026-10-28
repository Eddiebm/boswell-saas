import { describe, expect, it } from "vitest";
import {
  AUDIT_MODES,
  auditModeDescription,
  auditModeLabel,
  isAuditMode,
  normalizeAuditMode,
} from "@/lib/audit-modes";

describe("isAuditMode", () => {
  it("accepts each known mode", () => {
    for (const mode of AUDIT_MODES) expect(isAuditMode(mode)).toBe(true);
  });

  it("rejects unknown, differently-cased, empty and missing values", () => {
    expect(isAuditMode("turbo")).toBe(false);
    expect(isAuditMode("Deep")).toBe(false);
    expect(isAuditMode("")).toBe(false);
    expect(isAuditMode(null)).toBe(false);
    expect(isAuditMode(undefined)).toBe(false);
  });
});

describe("normalizeAuditMode", () => {
  it("keeps a valid mode", () => {
    expect(normalizeAuditMode("quick")).toBe("quick");
    expect(normalizeAuditMode("deep")).toBe("deep");
  });

  it("falls back to standard for anything else, including stored nulls", () => {
    expect(normalizeAuditMode("everything")).toBe("standard");
    expect(normalizeAuditMode(null)).toBe("standard");
    expect(normalizeAuditMode(undefined)).toBe("standard");
  });
});

describe("labels and descriptions", () => {
  it("gives every mode a distinct label and a description with a cost hint", () => {
    const labels = AUDIT_MODES.map(auditModeLabel);
    expect(new Set(labels).size).toBe(AUDIT_MODES.length);
    expect(auditModeLabel("quick")).toBe("Quick scan");
    expect(auditModeLabel("deep")).toBe("Deep audit");
    for (const mode of AUDIT_MODES) expect(auditModeDescription(mode)).toMatch(/\$\d/);
  });
});
