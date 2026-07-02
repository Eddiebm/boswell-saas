import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { accounts, sessions, users } from "@/lib/db/schema";
import { cookies } from "next/headers";

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
};

export async function signInOwner() {
  const bootstrapToken = process.env.GITHUB_BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    throw new Error("Owner bootstrap is not configured");
  }

  const ghRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${bootstrapToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Boswell-SaaS",
    },
  });

  if (!ghRes.ok) {
    throw new Error("Bootstrap GitHub token is invalid");
  }

  const gh = (await ghRes.json()) as GithubUser;
  const db = requireDb();
  const email = gh.email ?? `${gh.login}@users.noreply.github.com`;

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        name: gh.name ?? gh.login,
        email,
        image: gh.avatar_url,
        githubLogin: gh.login,
        plan: "team",
      })
      .returning();
  }

  const providerAccountId = String(gh.id);
  const [existingAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, providerAccountId)))
    .limit(1);

  if (existingAccount) {
    await db
      .update(accounts)
      .set({ access_token: bootstrapToken, userId: user.id })
      .where(
        and(
          eq(accounts.provider, "github"),
          eq(accounts.providerAccountId, providerAccountId),
        ),
      );
  } else {
    await db.insert(accounts).values({
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId,
      access_token: bootstrapToken,
      token_type: "bearer",
      scope: "read:user user:email repo",
    });
  }

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires,
  });

  const cookieName =
    process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";

  const jar = await cookies();
  jar.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  redirect("/dashboard");
}
