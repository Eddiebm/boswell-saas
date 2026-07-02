export type AutoFixLevel = "green" | "yellow" | "red";

export type SafeFixPolicy = {
  level: AutoFixLevel;
  canOpenPr: boolean;
  requiresApproval: boolean;
  reason: string;
};

const RED_CATEGORIES = ["auth", "payment", "cryptography", "database", "permissions", "security", "secrets"];
const GREEN_CATEGORIES = ["documentation", "dead-import", "unused-file", "formatting", "config"];

export function getSafeFixPolicy(input: {
  category: string;
  severity: string;
  classification: string;
  title: string;
}): SafeFixPolicy {
  const cat = input.category.toLowerCase();
  const title = input.title.toLowerCase();

  if (input.classification === "evil" || input.severity === "CRITICAL") {
    if (cat.includes("secret") || title.includes("api key") || cat.includes("auth")) {
      return {
        level: "red",
        canOpenPr: false,
        requiresApproval: true,
        reason: "Credential, auth, or critical security issues need manual verification and rotation.",
      };
    }
  }

  if (RED_CATEGORIES.some((r) => cat.includes(r) || title.includes(r))) {
    return {
      level: "red",
      canOpenPr: false,
      requiresApproval: true,
      reason: "Touches auth, payments, crypto, DB, or permissions — manual only.",
    };
  }

  if (GREEN_CATEGORIES.some((g) => cat.includes(g))) {
    return {
      level: "green",
      canOpenPr: true,
      requiresApproval: false,
      reason: "Mechanical, low-risk change suitable for an automated PR.",
    };
  }

  if (input.severity === "LOW" || input.severity === "INFO") {
    return {
      level: "green",
      canOpenPr: true,
      requiresApproval: false,
      reason: "Low severity — safe to propose via PR with standard review.",
    };
  }

  return {
    level: "yellow",
    canOpenPr: false,
    requiresApproval: true,
    reason: "Refactor or behavior-adjacent change — Boswell can propose a patch for human approval.",
  };
}
