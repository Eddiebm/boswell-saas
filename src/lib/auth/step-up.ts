"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth, signIn } from "@/lib/auth";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { canUsePrAutomation, type PlanId } from "@/lib/plans";

/**
 * The scope requested when a Pro+ user actually enables PR automation.
 * Everyone else keeps the narrow `read:user user:email` scope requested at
 * signup (see src/lib/auth.ts) — this route is the only place the broader
 * `repo` scope is ever requested from GitHub.
 */
const PR_AUTOMATION_SCOPE = "read:user user:email repo";

/**
 * Server Action that performs an incremental/step-up GitHub OAuth
 * re-authorization, asking for the `repo` scope. Only Pro+ users who are
 * actually trying to use PR automation should reach this — it re-checks the
 * plan server-side regardless of what the caller believes.
 */
export async function authorizeGithubRepoScope(redirectTo = "/dashboard/fix-queue") {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const plan = (user?.plan ?? "free") as PlanId;

  if (!canUsePrAutomation(plan)) {
    redirect(`${redirectTo}?error=pr-automation-requires-upgrade`);
  }

  await signIn("github", { redirectTo }, { scope: PR_AUTOMATION_SCOPE });
}
