/**
 * Edge-safe auth config — no Node.js built-ins (no fs, path, better-sqlite3).
 * Used by middleware (Edge runtime) and extended by lib/auth.ts (Node runtime).
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";

function getBaseUrl(fallbackBaseUrl: string): string {
  if (process.env.AUTH_URL && !process.env.AUTH_URL.includes("localhost")) {
    return process.env.AUTH_URL;
  }
  if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.includes("localhost")) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return fallbackBaseUrl;
}

export const authConfig = {
  trustHost: true,
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID ?? "common"}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read",
          prompt: "select_account",
        },
      },
      profile(profile) {
        const email =
          profile.email ||
          profile.preferred_username ||
          (profile as Record<string, any>).upn ||
          (profile as Record<string, any>).mail ||
          "";
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username || email,
          email: email ? email.toLowerCase() : "",
          image: null,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      const effectiveBaseUrl = getBaseUrl(baseUrl);
      if (url.startsWith("/") && !url.startsWith("//")) {
        return `${effectiveBaseUrl}${url}`;
      }
      try {
        const parsedUrl = new URL(url);
        const parsedBase = new URL(effectiveBaseUrl);
        if (parsedUrl.origin === parsedBase.origin) {
          return url;
        }
      } catch {
        // Fallback below
      }
      return effectiveBaseUrl;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email.toLowerCase();
        token.name = user.name;
        if (user.image) token.picture = user.image;
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.role = (token.role as import("./lib/types").Role) ?? "viewer";
        session.user.id = (token.userId as string) ?? "";
        session.user.username = (token.username as string | null) ?? null;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const isProtected =
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/api/equipment") ||
        pathname.startsWith("/api/events") ||
        pathname.startsWith("/api/nfc") ||
        pathname.startsWith("/api/sop") ||
        pathname.startsWith("/api/tags") ||
        pathname.startsWith("/api/users");

      if (isProtected && !isLoggedIn) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;
