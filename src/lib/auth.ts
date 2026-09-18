import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

// Free-tier signers only browse/score repos and never need write access to
// private repos, so the *initial* OAuth request only asks for read access to
// the user's profile/email. The broader `repo` scope (needed for PR
// automation, see src/lib/github/pr.ts) is requested later, only from Pro+
// users who actually enable PR automation, via the incremental/step-up
// re-authorization in src/lib/auth/step-up.ts.
const DEFAULT_GITHUB_SCOPE = "read:user user:email";

const adapter = db
  ? DrizzleAdapter(db, {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    })
  : undefined;

const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: {
          scope: DEFAULT_GITHUB_SCOPE,
        },
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ account }) {
      // When a user who already has a linked GitHub account signs in again
      // (e.g. the step-up re-authorization in src/lib/auth/step-up.ts that
      // requests the broader `repo` scope), NextAuth's default adapter flow
      // recognizes the account is already linked and skips persisting the
      // freshly issued token/scope. Persist it here so incremental OAuth
      // actually takes effect instead of silently keeping the old scope.
      // (For a brand-new account this UPDATE simply matches zero rows —
      // the normal adapter flow then inserts it with the requested scope.)
      if (db && account?.provider === "github" && account.access_token) {
        await db
          .update(schema.accounts)
          .set({
            access_token: account.access_token,
            token_type: account.token_type ?? null,
            scope: account.scope ?? null,
            expires_at:
              typeof account.expires_at === "number" ? account.expires_at : null,
          })
          .where(
            and(
              eq(schema.accounts.provider, "github"),
              eq(schema.accounts.providerAccountId, account.providerAccountId),
            ),
          );
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  session: {
    strategy: adapter ? "database" : "jwt",
  },
  trustHost: true,
});
