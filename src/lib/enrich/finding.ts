import { classifyFinding, type FindingClassification } from "@/lib/classification/classify";
import { getSafeFixPolicy, type AutoFixLevel } from "@/lib/automation/safe-fix-policy";

export type EnrichedFinding = {
  classification: FindingClassification;
  autoFixLevel: AutoFixLevel;
  simpleExplanation: string;
  canOpenPr: boolean;
};

export function enrichFinding(input: {
  title: string;
  description: string;
  severity: string;
  category: string;
  isPositive?: boolean;
}): EnrichedFinding {
  const classified = classifyFinding({
    title: input.title,
    description: input.description,
    severity: input.severity,
    category: input.category,
    isPositive: input.isPositive,
  });

  const policy = getSafeFixPolicy({
    category: input.category,
    severity: input.severity,
    classification: classified.classification,
    title: input.title,
  });

  return {
    classification: classified.classification,
    autoFixLevel: policy.level,
    simpleExplanation: classified.plainMeaning,
    canOpenPr: policy.canOpenPr,
  };
}
