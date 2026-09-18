import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { canUseDynamicVerify } from "@/lib/plans";
import { createVerifyTarget, listVerifyTargets } from "@/lib/dynamic-verify/run";
import { requireDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repositoryId = new URL(request.url).searchParams.get("repositoryId");
  if (!repositoryId) {
    return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
  }

  const targets = await listVerifyTargets(session.user.id, repositoryId);
  return NextResponse.json({ targets });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || !canUseDynamicVerify(user.plan)) {
    return NextResponse.json(
      { error: "Live access-control verification requires the Pro plan." },
      { status: 403 },
    );
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
    const target = await createVerifyTarget(session.user.id, body.repositoryId as string, {
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
    return NextResponse.json({ target });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create verification target";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
