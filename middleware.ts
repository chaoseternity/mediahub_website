/**
 * Middleware runs in the Edge runtime — must only import edge-safe modules.
 * auth.config.ts has no Node.js built-in dependencies (no fs/path/better-sqlite3).
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

const { auth } = NextAuth(authConfig);

// Stricter limit for auth endpoints to prevent brute-force attacks.
const AUTH_LIMIT = 10;
const API_LIMIT = 60;
const WINDOW_MS = 60_000; // 1 minute

function getClientIp(req: Request): string {
  // cf-connecting-ip is set by Cloudflare's CDN in production.
  // Fall back to x-forwarded-for for local dev / other proxies.
  const headers = req.headers as Headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // --- Rate limiting (applied before auth checks) ---
  const ip = getClientIp(req);
  const isAuthRoute = pathname.startsWith("/api/auth/");
  const limit = isAuthRoute ? AUTH_LIMIT : API_LIMIT;

  if (!checkRateLimit(ip, limit, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(WINDOW_MS / 1000) },
      }
    );
  }

  // --- Auth checks ---
  const isAuthenticated = !!req.auth;

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const loginUrl = new URL(`/login?callbackUrl=${encodeURIComponent(pathname)}`, `${proto}://${host}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/api/equipment/:path*", "/api/users/:path*"],
};
