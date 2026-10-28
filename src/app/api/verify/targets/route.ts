import { NextResponse } from "next/server";
import { getOptionalUserId } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { canUseDynamicVerify } from "@/lib/plans";
import { createVerifyTarget, listVerifyTargets, toPublicTarget } from "@/lib/dynamic-verify/run";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isDemoMode } from "@/lib/demo/mode";

export async function GET(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repositoryId = new URL(request.url).searchParams.get("repositoryId");
  if (!repositoryId) {
    return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
  }

  const targets = await listVerifyTargets(userId, repositoryId);
  return NextResponse.json({ targets: targets.map(toPublicTarget) });
}

export async function POST(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDemoMode()) {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !canUseDynamicVerify(user.plan)) {
      return NextResponse.json(
        { error: "Live access-control verification requires the Pro plan." },
        { status: 403 },
      );
    }
  }

  const rl = rateLimit(`verify-target:${clientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const required = [
    "repositoryId",
    "label",
    "stagingUrl",
    "loginPath",
    "accountAEmail",
    "accountAPassword",
    "accountBEmail",
    "accountBPassword",
    "resourcePathTemplate",
    "accountAResourceId",
  ];
  for (const field of required) {
    if (typeof body[field] !== "string" || !(body[field] as string).trim()) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  if (body.consentConfirmed !== true) {
    return NextResponse.json(
      {
        error:
          "consentConfirmed must be true: confirm this is a staging or non-production environment you own or are authorized to test.",
      },
      { status: 400 },
    );
  }

  try {
    const target = await createVerifyTarget(userId, body.repositoryId as string, {
      label: body.label as string,
      stagingUrl: body.stagingUrl as string,
      loginPath: body.loginPath as string,
      accountAEmail: body.accountAEmail as string,
      accountAPassword: body.accountAPassword as string,
      accountBEmail: body.accountBEmail as string,
      accountBPassword: body.accountBPassword as string,
      resourcePathTemplate: body.resourcePathTemplate as string,
      accountAResourceId: body.accountAResourceId as string,
      consentConfirmed: true,
    });
    return NextResponse.json({ target: toPublicTarget(target) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create verification target";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
