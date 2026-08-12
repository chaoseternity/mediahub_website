import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { upsertUser, getUserByEmail } from "./db";
import type { Role } from "./types";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      const allowedProviders = ["google", "microsoft-entra-id"];
      if (!account?.provider || !allowedProviders.includes(account.provider)) return false;
      if (!user.email || !user.name || !account.providerAccountId) return false;

      await upsertUser({
        name: user.name,
        email: user.email,
        google_id: account.providerAccountId,
        image: user.image ?? null,
        provider: account.provider,
      });

      return true;
    },

    async jwt({ token, account }) {
      // Re-read role from DB on every token evaluation so that admin-changed
      // roles take effect on the user's next page navigation without re-login.
      const dbUser = await getUserByEmail(token.email!);
      token.role = dbUser?.role ?? "viewer";
      token.userId = String(dbUser?.id ?? "");
      token.username = dbUser?.username ?? null;
      // On initial sign-in, account is present — no extra work needed.
      void account;
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as Role) ?? "viewer";
        session.user.id = token.userId as string;
        session.user.username = (token.username as string | null) ?? null;
      }
      return session;
    },
  },
});
