export type CoachingSections = {
  whatHappened: string;
  whyGood?: string;
  whyBad?: string;
  whyDangerous?: string;
  whyAiGenerated?: string;
  howToThink: string;
  howToFix: string;
  autoFixStatus: "safe" | "review" | "manual";
  autoFixReason: string;
  ifIgnored: string;
  confidence: number;
  evidence: string[];
  explainLikeImNew: string;
};

type FindingInput = {
  title: string;
  description: string;
  severity: string;
  category: string;
  filePath?: string;
  recommendation?: string;
  isPositive?: boolean;
};

export function buildCoaching(finding: FindingInput): CoachingSections {
  const isCritical = finding.severity === "CRITICAL";
  const isHigh = finding.severity === "HIGH";
  const isSecurity = finding.category.includes("secret") || finding.category === "security";

  const whatHappened = finding.isPositive
    ? `Boswell found something well done: ${finding.title}`
    : `Boswell found an issue in your code: ${finding.title}. ${plainSummary(finding.description)}`;

  const whyGood = finding.isPositive
    ? `This is a sign of thoughtful engineering. ${finding.description}`
    : undefined;

  const whyBad = finding.isPositive
    ? undefined
    : consequenceForCategory(finding.category, finding.description);

  const whyDangerous = isSecurity || isCritical
    ? `This could allow unauthorized access, data leaks, or service abuse if exploited. Severity is ${finding.severity.toLowerCase()} based on static evidence — not a guess.`
    : isHigh
      ? "This may not break production today, but it increases the chance of bugs, outages, or security gaps as the codebase grows."
      : undefined;

  const whyAiGenerated = looksAiGenerated(finding.description)
    ? "This pattern is common in AI-generated code: generic naming, placeholder comments, or duplicated helpers. This is an indicator, not proof a human did not write it."
    : undefined;

  const howToThink =
    "Experienced teams fix root causes, not symptoms. Ask: will this get worse with every new feature? If yes, prioritize it before adding more code on top.";

  const howToFix = finding.recommendation
    ? `Steps:\n1. Open ${finding.filePath ?? "the flagged file"}.\n2. ${finding.recommendation}\n3. Run tests and re-audit.\nEffort: ${effortEstimate(finding.severity)}. Risk of change: ${changeRisk(finding.severity)}.`
    : `Review ${finding.filePath ?? "the affected files"}, make the smallest safe change, and verify with tests.`;

  const auto = autoFixability(finding);
  const ifIgnored = ignoreConsequence(finding.severity, finding.category);

  const evidence = [
    finding.filePath ? `File: ${finding.filePath}` : "Static analysis",
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
  ];

  const explainLikeImNew = buildEli5(finding);

  return {
    whatHappened,
    whyGood,
    whyBad,
    whyDangerous,
    whyAiGenerated,
    howToThink,
    howToFix,
    autoFixStatus: auto.status,
    autoFixReason: auto.reason,
    ifIgnored,
    confidence: confidenceFor(finding),
    evidence,
    explainLikeImNew,
  };
}

function plainSummary(text: string) {
  return text.replace(/\*\*/g, "").slice(0, 280);
}

function consequenceForCategory(category: string, desc: string): string {
  if (category.includes("duplicate")) {
    return "Duplicated logic means future fixes may only land in one copy, creating hidden bugs.";
  }
  if (category === "architecture") {
    return "Structural issues slow every future change and make onboarding harder.";
  }
  return `Left alone, this adds maintenance cost: ${desc.slice(0, 160)}`;
}

function looksAiGenerated(desc: string): boolean {
  const markers = ["generic", "placeholder", "todo", "helper", "boilerplate", "wrapper"];
  const low = desc.toLowerCase();
  return markers.some((m) => low.includes(m));
}

function effortEstimate(severity: string): string {
  if (severity === "CRITICAL" || severity === "HIGH") return "medium (1–4 hours)";
  if (severity === "MEDIUM") return "small (30–90 minutes)";
  return "tiny (under 30 minutes)";
}

function changeRisk(severity: string): string {
  if (severity === "CRITICAL") return "medium — test carefully";
  if (severity === "HIGH") return "low–medium";
  return "low";
}

function autoFixability(finding: FindingInput): { status: CoachingSections["autoFixStatus"]; reason: string } {
  const safeCategories = ["documentation", "dead-import", "config", "unused-file"];
  if (safeCategories.some((c) => finding.category.includes(c))) {
    return { status: "safe", reason: "Mechanical change with low behavioral risk." };
  }
  if (finding.category.includes("secret") || finding.severity === "CRITICAL") {
    return { status: "manual", reason: "Credential rotation and history cleanup need human verification." };
  }
  if (finding.severity === "HIGH") {
    return { status: "review", reason: "Boswell can suggest a patch, but a human should review before merge." };
  }
  return { status: "review", reason: "Default safe path — open a PR, do not auto-merge." };
}

function ignoreConsequence(severity: string, category: string): string {
  if (severity === "CRITICAL" || category.includes("secret")) {
    return "Security risk compounds; possible unauthorized access or compliance failure.";
  }
  if (severity === "HIGH") {
    return "Technical debt grows; future features become slower and riskier to ship.";
  }
  return "Probably manageable short-term, but noise accumulates and obscures real problems.";
}

function confidenceFor(finding: FindingInput): number {
  let base = 0.75;
  if (finding.filePath) base += 0.12;
  if (finding.category.includes("secret")) base += 0.08;
  if (finding.isPositive) base = 0.88;
  return Math.min(0.98, Math.round(base * 100) / 100);
}

function buildEli5(finding: FindingInput): string {
  if (finding.isPositive) {
    return "Think of this like a well-labeled toolbox: anyone on the team can find the right tool quickly and work safely.";
  }
  if (finding.category.includes("secret")) {
    return "Imagine leaving your house key taped to the front door. The door still works, but anyone who sees the key can get in.";
  }
  if (finding.category.includes("duplicate")) {
    return "It's like having six copies of the same instruction manual in different drawers. When you update one, the others stay wrong.";
  }
  return "This is like a warning light on a car dashboard — the car may still run, but something needs attention before it becomes a bigger problem.";
}
