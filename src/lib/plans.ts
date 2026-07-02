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
      "Shared org dashboard",
      "Export + API access",
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
