/**
 * Middleware runs in the Edge runtime — must only import edge-safe modules.
 * auth.config.ts has no Node.js built-in dependencies (no fs/path/better-sqlite3).
 *
 * Responsibilities: rate limiting, CSRF protection for mutating API requests, and
 * authentication gating (signed-in or not).
 *
 * Role-based authorization is deliberately NOT done here: the Edge JWT's role is only
 * refreshed when the token is re-issued, so a freshly promoted admin would be blocked (and a
 * demoted one let through) until their cookie rotates. Every admin/verified-only route handler
 * and dashboard page re-reads the role from the database via `auth()` in lib/auth.ts instead.
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse, type NextRequest } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  getRateLimitKey,
  limitFor,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitBucket,
} from "@/lib/rate-limit";
import { checkCsrf, CSRF_ERROR_MESSAGE } from "@/lib/request-security";

const { auth } = NextAuth(authConfig);

function tooManyRequests() {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { "Retry-After": String(RATE_LIMIT_WINDOW_MS / 1000) },
    }
  );
}

function isRateLimited(bucket: RateLimitBucket, identity: { userId?: string | null; ip: string }): boolean {
  const key = getRateLimitKey(bucket, identity);
  return !checkRateLimit(key, limitFor(bucket, key), RATE_LIMIT_WINDOW_MS);
}

const authMiddleware = auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth?.user;

  // --- Rate limiting: per user when signed in (many students share one school NAT IP),
  // per client IP otherwise. ---
  const userId = isAuthenticated ? req.auth?.user?.id || req.auth?.user?.email || null : null;
  if (isRateLimited("api", { userId, ip: getClientIp(req.headers) })) {
    return tooManyRequests();
  }

  // --- CSRF protection for state-modifying API requests ---
  const csrf = checkCsrf({
    method: req.method,
    pathname,
    appOrigin: req.nextUrl.origin,
    headers: req.headers,
  });
  if (!csrf.ok) {
    return NextResponse.json({ error: CSRF_ERROR_MESSAGE }, { status: 403 });
  }

  // --- Authentication gating ---
  const isPublicApiRoute = pathname.startsWith("/api/rsvp") || pathname.startsWith("/api/cron");

  if (!isAuthenticated && !isPublicApiRoute) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL(`/login?callbackUrl=${encodeURIComponent(pathname)}`, req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export default async function middleware(req: NextRequest, ctx: unknown) {
  const { pathname } = req.nextUrl;

  // CRITICAL: NextAuth routes (/api/auth/*) must BYPASS the NextAuth auth() session-rolling wrapper.
  // When auth() wraps /api/auth/signout, it automatically injects a renewed session token cookie
  // that clashes with and overrides the route handler's Max-Age=0 deletion cookie, resurrecting the session.
  if (pathname.startsWith("/api/auth/")) {
    // Sign out is never rate limited so users are never trapped.
    if (pathname.startsWith("/api/auth/signout")) {
      return NextResponse.next();
    }
    // Auth routes get their own per-IP buckets so API traffic can't exhaust logins.
    const isAuthRead =
      pathname === "/api/auth/session" ||
      pathname === "/api/auth/csrf" ||
      pathname === "/api/auth/providers";
    if (isRateLimited(isAuthRead ? "auth-read" : "auth", { ip: getClientIp(req.headers) })) {
      return tooManyRequests();
    }
    return NextResponse.next();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authMiddleware as any)(req, ctx);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
