export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    auditsPerMonth: 3,
    maxRepos: 2,
    features: ["3 audits / month", "2 connected repos", "Security + handoff reports"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 29,
    auditsPerMonth: 50,
    maxRepos: 25,
    features: [
      "50 audits / month",
      "25 connected repos",
      "Scheduled re-audits",
      "Priority worker queue",
    ],
  },
  team: {
    id: "team",
    name: "Team",
    priceMonthly: 99,
    auditsPerMonth: 200,
    maxRepos: 100,
    features: [
      "200 audits / month",
      "100 connected repos",
      "Scheduled audits",
      "PR automation",
      "Engineering memory + Q&A",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    priceMonthly: 299,
    auditsPerMonth: 1000,
    maxRepos: 500,
    features: [
      "Unlimited-scale audits",
      "Executive dashboard",
      "Advanced reports",
      "Priority support",
      "Custom safe-fix policies",
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function getPlanLimits(plan: PlanId) {
  return PLANS[plan];
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  team: 2,
  business: 3,
};

export function planMeetsMinimum(current: PlanId, required: PlanId): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export function canUsePrAutomation(plan: PlanId): boolean {
  return planMeetsMinimum(plan, "team");
}

export function canUseLlmBrain(plan: PlanId): boolean {
  return planMeetsMinimum(plan, "pro");
}

export function canUseExecutiveDashboard(plan: PlanId): boolean {
  return planMeetsMinimum(plan, "business");
}
