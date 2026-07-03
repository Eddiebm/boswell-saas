export const AUDIT_MODES = ["quick", "standard", "deep"] as const;

export type AuditMode = (typeof AUDIT_MODES)[number];

export function isAuditMode(value: string | undefined | null): value is AuditMode {
  return value != null && (AUDIT_MODES as readonly string[]).includes(value);
}

export function auditModeLabel(mode: AuditMode): string {
  switch (mode) {
    case "quick":
      return "Quick scan";
    case "standard":
      return "Standard";
    case "deep":
      return "Deep audit";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function auditModeDescription(mode: AuditMode): string {
  switch (mode) {
    case "quick":
      return "Leak scan + focused audit. Skips handoff and lessons. ~$0.08–0.15.";
    case "standard":
      return "Full audit + handoff. Skips extra rewrites. ~$0.20–0.35.";
    case "deep":
      return "Everything: audit, handoff, plain-English versions, lessons. ~$0.30–1.00+.";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function normalizeAuditMode(value: string | undefined | null): AuditMode {
  return isAuditMode(value) ? value : "standard";
}
