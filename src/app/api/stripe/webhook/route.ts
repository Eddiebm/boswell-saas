import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { planFromStripePrice, stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing webhook signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = requireDb();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const plan =
      (session.metadata?.plan as "pro" | "team" | "business" | undefined) ?? "pro";
    if (userId) {
      await db.update(users).set({ plan }).where(eq(users.id, userId));
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const subscription = event.data.object;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const priceId = subscription.items.data[0]?.price.id;
    const plan = planFromStripePrice(priceId);
    await db.update(users).set({ plan }).where(eq(users.stripeCustomerId, customerId));
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    await db.update(users).set({ plan: "free" }).where(eq(users.stripeCustomerId, customerId));
  }

  return NextResponse.json({ received: true });
}
