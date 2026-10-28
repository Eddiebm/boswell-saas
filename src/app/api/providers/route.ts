import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { encryptSecret } from "@/lib/crypto/secrets";
import { isDemoMode } from "@/lib/demo/mode";
import { requireDb } from "@/lib/db";
import { providerConnections } from "@/lib/db/schema";
import { defaultProviderFetch, providerLabel, type ProviderName } from "@/lib/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getRepositoryForUser } from "@/lib/repositories";
import { getOptionalUserId } from "@/lib/session";

const PROVIDERS: ProviderName[] = ["supabase", "vercel", "neon"];
const REF = /^[A-Za-z0-9_.-]{1,100}$/;

/** A cheap read that proves the token can see the project before it's saved. */
function probeUrl(provider: ProviderName, ref: string, teamId?: string) {
  const r = encodeURIComponent(ref);
  if (provider === "supabase") return `https://api.supabase.com/v1/projects/${r}`;
  if (provider === "neon") return `https://console.neon.tech/api/v2/projects/${r}`;
  return `https://api.vercel.com/v9/projects/${r}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`;
}

async function context(request: Request) {
  const userId = await getOptionalUserId();
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const rl = rateLimit(`providers:${clientIp(request)}`, 20, 60_000);
  if (!rl.ok) return { error: NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }) };
  return { userId };
}

/** Connect (or replace) a provider for one repository. */
export async function POST(request: Request) {
  const ctx = await context(request);
  if ("error" in ctx) return ctx.error;
  const body = (await request.json().catch(() => ({}))) as { repositoryId?: string; provider?: string; projectRef?: string; teamId?: string; token?: string };
  const provider = body.provider as ProviderName;
  const projectRef = body.projectRef?.trim() ?? "";
  const teamId = body.teamId?.trim() || undefined;
  const token = body.token?.trim() ?? "";
  if (!body.repositoryId || !PROVIDERS.includes(provider) || !REF.test(projectRef) || (teamId && !REF.test(teamId)) || token.length < 8 || token.length > 500) {
    return NextResponse.json({ error: "repositoryId, provider, a project ID and a token are required" }, { status: 400 });
  }
  if (isDemoMode()) return NextResponse.json({ ok: true, message: `Demo mode — ${providerLabel(provider)} connection simulated.` });

  const repo = await getRepositoryForUser(ctx.userId, body.repositoryId);
  if (!repo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const probe = await defaultProviderFetch(probeUrl(provider, projectRef, teamId), { token }).catch(() => null);
  if (!probe || probe.status !== 200) {
    return NextResponse.json(
      { error: `${providerLabel(provider)} didn't accept that token for project "${projectRef}"${probe ? ` (HTTP ${probe.status})` : ""}. Check both and try again.` },
      { status: 400 },
    );
  }

  const db = requireDb();
  await db.delete(providerConnections).where(and(eq(providerConnections.repositoryId, repo.id), eq(providerConnections.provider, provider)));
  await db.insert(providerConnections).values({ userId: ctx.userId, repositoryId: repo.id, provider, projectRef, teamId: teamId ?? null, token: encryptSecret(token) });
  return NextResponse.json({ ok: true, message: `${providerLabel(provider)} connected. It's checked on the next audit.` });
}

/** Disconnect a provider. The token is deleted; revoke it with the provider too. */
export async function DELETE(request: Request) {
  const ctx = await context(request);
  if ("error" in ctx) return ctx.error;
  const body = (await request.json().catch(() => ({}))) as { repositoryId?: string; provider?: string };
  if (!body.repositoryId || !PROVIDERS.includes(body.provider as ProviderName)) {
    return NextResponse.json({ error: "repositoryId and provider required" }, { status: 400 });
  }
  if (isDemoMode()) return NextResponse.json({ ok: true });
  const repo = await getRepositoryForUser(ctx.userId, body.repositoryId);
  if (!repo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = requireDb();
  await db.delete(providerConnections).where(and(eq(providerConnections.repositoryId, repo.id), eq(providerConnections.provider, body.provider as string)));
  return NextResponse.json({ ok: true });
}
