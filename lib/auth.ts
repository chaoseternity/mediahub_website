import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { upsertUser, getUserByEmail } from "./db";
import type { Role } from "./types";

/** Microsoft sign-ins are restricted to school accounts. Google is unrestricted for now. */
export const MICROSOFT_ALLOWED_EMAIL_DOMAIN = "nushigh.edu.sg";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedMicrosoftEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${MICROSOFT_ALLOWED_EMAIL_DOMAIN}`);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      const allowedProviders = ["google", "microsoft-entra-id"];
      if (!account?.provider || !allowedProviders.includes(account.provider)) return false;
      const email = user.email?.trim().toLowerCase();
      if (!email || !user.name || !account.providerAccountId) return false;

      if (account.provider === "microsoft-entra-id") {
        if (!isAllowedMicrosoftEmail(email)) return "/login?error=MicrosoftDomain";
        // When a specific tenant is configured, reject tokens issued by any other tenant.
        const tenantId = process.env.AZURE_AD_TENANT_ID;
        if (tenantId && GUID_RE.test(tenantId)) {
          const tid = (profile as Record<string, unknown> | undefined)?.tid;
          if (typeof tid !== "string" || tid.toLowerCase() !== tenantId.toLowerCase()) {
            return "/login?error=MicrosoftDomain";
          }
        }
      }

      if (account.provider === "google" && (profile as Record<string, unknown> | undefined)?.email_verified === false) {
        return false;
      }

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
