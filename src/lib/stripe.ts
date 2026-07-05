import Stripe from "stripe";
import { PLANS, PUBLIC_PLAN_IDS, type PlanId } from "@/lib/plans";

export const stripe =
  process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

export function getStripePriceId(plan: Exclude<PlanId, "free">) {
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO ?? "";
  if (plan === "team") return process.env.STRIPE_PRICE_TEAM ?? "";
  return process.env.STRIPE_PRICE_BUSINESS ?? "";
}

export function planFromStripePrice(priceId: string | null | undefined): PlanId {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return "business";
  return "free";
}

export function publicPlanSummary() {
  return PUBLIC_PLAN_IDS.map((id) => PLANS[id]);
}
