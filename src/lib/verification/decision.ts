export type VerificationDecision = "REJECTED" | "PARTIAL" | "PASS WITH RISKS" | "VERIFIED";

export function findingKey(finding: { title: string; filePath?: string | null }): string {
  return `${finding.title.trim().toLowerCase()}|${(finding.filePath ?? "").trim().toLowerCase()}`;
}

export function decideRepairVerification(input: {
  previous: Array<{ title: string; filePath?: string | null }>;
  current: Array<{ title: string; filePath?: string | null; severity: string }>;
}): VerificationDecision {
  const currentKeys = new Set(input.current.map(findingKey));
  const repairedCount = input.previous.filter((finding) => !currentKeys.has(findingKey(finding))).length;
  const blockersRemain = input.current.some(
    (finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH",
  );
  if (blockersRemain) return repairedCount > 0 ? "PARTIAL" : "REJECTED";
  if (input.current.length > 0) return "PASS WITH RISKS";
  return "VERIFIED";
}
