import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { upsertUser, getUserByEmail } from "./db";
import type { Role } from "./types";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      const allowedProviders = ["google", "microsoft-entra-id"];
      if (!account?.provider || !allowedProviders.includes(account.provider)) return false;
      const email = user.email?.trim().toLowerCase();
      if (!email || !user.name || !account.providerAccountId) return false;

      await upsertUser({
        name: user.name,
        email,
        google_id: account.providerAccountId,
        image: user.image ?? null,
        provider: account.provider,
      });

      return true;
    },

    async jwt({ token, user, account }) {
      // If a user just authenticated, overwrite token identity completely
      // to ensure switching accounts immediately updates the session.
      if (user?.email) {
        token.email = user.email.trim().toLowerCase();
        token.name = user.name;
        if (user.image) token.picture = user.image;
        token.userId = user.id;
        token.role = undefined;
        token.username = undefined;
      }

      // Re-read role from DB on every token evaluation so that admin-changed
      // roles take effect on the user's next page navigation without re-login.
      if (!token.email) return token;
      const dbUser = await getUserByEmail(token.email);
      if (!dbUser) {
        token.userId = "";
        token.role = "viewer";
        token.username = null;
        return token;
      }
      token.role = dbUser.role ?? "viewer";
      token.userId = String(dbUser.id);
      token.username = dbUser.username ?? null;
      token.name = dbUser.name ?? token.name;
      token.email = dbUser.email;
      void account;
      return token;
    },

    async session({ session, token }) {
      if (!token.userId) {
        return null as any;
      }
      if (session.user) {
        session.user.role = (token.role as Role) ?? "viewer";
        session.user.id = token.userId as string;
        session.user.username = (token.username as string | null) ?? null;
      }
      return session;
    },
  },
});
