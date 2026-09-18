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
  const headers = req.headers as Headers;
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[0];
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
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

  // --- CSRF Protection for state-modifying requests ---
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (isMutation && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    const origin = req.headers.get("origin");
    if (origin && (origin === "null" || origin !== req.nextUrl.origin)) {
      return NextResponse.json(
        { error: "Forbidden: Cross-site requests are not allowed" },
        { status: 403 }
      );
    }
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite === "cross-site") {
      return NextResponse.json(
        { error: "Forbidden: Cross-site requests are not allowed" },
        { status: 403 }
      );
    }
  }

  // --- Auth checks ---
  const isAuthenticated = !!req.auth;
  const isPublicApiRoute = pathname.startsWith("/api/auth/") || pathname.startsWith("/api/rsvp");

  if (!isAuthenticated && !isPublicApiRoute) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL(`/login?callbackUrl=${encodeURIComponent(pathname)}`, req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
