export type FindingClassification = "good" | "bad" | "dangerous" | "evil";

export type ClassifiedFinding = {
  classification: FindingClassification;
  urgency: "low" | "medium" | "high" | "critical";
  plainMeaning: string;
};

export type ClassifyInput = {
  severity: string;
  category: string;
  title: string;
  description: string;
  isPositive?: boolean;
};

const EVIL_MARKERS = [
  "hardcoded secret",
  "api key committed",
  "sql injection",
  "bypass auth",
  "bypass permission",
  "plaintext password",
  "private key",
  "rce",
  "remote code execution",
  "eval(",
  "disable ssl",
];

const DANGEROUS_MARKERS = [
  "secret",
  "credential",
  "auth",
  "payment",
  "stripe",
  "database",
  "migration",
  "unhandled",
  "xss",
  "csrf",
  "injection",
  "production",
  "permission",
];

const GOOD_MARKERS = [
  "well structured",
  "well organized",
  "clean architecture",
  "good test",
  "secure pattern",
  "clear naming",
  "reusable",
  "maintainable",
  "centralized",
];

export function classifyFinding(input: ClassifyInput): ClassifiedFinding {
  if (input.isPositive) {
    return {
      classification: "good",
      urgency: "low",
      plainMeaning: "This is an example of solid engineering worth keeping and repeating.",
    };
  }

  const text = `${input.title} ${input.description} ${input.category}`.toLowerCase();

  if (input.severity === "CRITICAL" && EVIL_MARKERS.some((m) => text.includes(m))) {
    return {
      classification: "evil",
      urgency: "critical",
      plainMeaning:
        "This pattern could seriously harm the business — data leak, breach, or production failure. Treat as emergency.",
    };
  }

  if (
    input.severity === "CRITICAL" ||
    input.severity === "HIGH" ||
    DANGEROUS_MARKERS.some((m) => text.includes(m))
  ) {
    return {
      classification: "dangerous",
      urgency: input.severity === "CRITICAL" ? "critical" : "high",
      plainMeaning:
        "This could cause security, reliability, or money problems if shipped or left unfixed.",
    };
  }

  if (GOOD_MARKERS.some((m) => text.includes(m)) || input.severity === "INFO") {
    return {
      classification: "good",
      urgency: "low",
      plainMeaning: "This supports maintainability or security — a pattern to preserve.",
    };
  }

  return {
    classification: "bad",
    urgency: input.severity === "MEDIUM" ? "medium" : "low",
    plainMeaning: "This adds mess or debt but is unlikely to break production today.",
  };
}

export function groupByClassification<T extends { classification: FindingClassification }>(
  items: T[],
): Record<FindingClassification, T[]> {
  return {
    good: items.filter((i) => i.classification === "good"),
    bad: items.filter((i) => i.classification === "bad"),
    dangerous: items.filter((i) => i.classification === "dangerous"),
    evil: items.filter((i) => i.classification === "evil"),
  };
}
