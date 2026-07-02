import Stripe from "stripe";
import { PLANS, type PlanId } from "@/lib/plans";

export const stripe =
  process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

export function getStripePriceId(plan: Exclude<PlanId, "free">) {
  if (plan === "pro") {
    return process.env.STRIPE_PRICE_PRO ?? "";
  }
  return process.env.STRIPE_PRICE_TEAM ?? "";
}

export function planFromStripePrice(priceId: string | null | undefined): PlanId {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return "free";
}

export function publicPlanSummary() {
  return Object.values(PLANS);
}
