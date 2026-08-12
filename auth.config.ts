/**
 * Edge-safe auth config — no Node.js built-ins (no fs, path, better-sqlite3).
 * Used by middleware (Edge runtime) and extended by lib/auth.ts (Node runtime).
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";

export const authConfig = {
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID ?? "common"}/v2.0`,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const isProtected =
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/api/equipment") ||
        pathname.startsWith("/api/users");

      if (isProtected && !isLoggedIn) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;
