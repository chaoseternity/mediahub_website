/**
 * Middleware helpers: CSRF policy, platform-aware client IP extraction, rate-limit keys
 * (per user vs per IP), LRU eviction, and the middleware wiring itself.
 */
import { NextRequest } from "next/server";
import { checkCsrf, CSRF_ERROR_MESSAGE } from "@/lib/request-security";
import {
  checkRateLimit,
  detectPlatform,
  getClientIp,
  getRateLimitKey,
  limitFor,
  rateLimitKeys,
  resetRateLimits,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// The session the mocked NextAuth wrapper attaches as `req.auth`.
let mockSession: { user: { id: string; email: string; role: string } } | null = null;

jest.mock("next-auth/providers/google", () => () => ({}));
jest.mock("next-auth/providers/microsoft-entra-id", () => () => ({}));
jest.mock("next-auth", () => () => ({
  auth:
    (handler: (req: unknown) => unknown) =>
    async (req: { auth?: unknown }) => {
      req.auth = mockSession;
      return handler(req);
    },
}));

const APP = "http://localhost:3000";

function headers(init: Record<string, string>) {
  return new Headers(init);
}

describe("checkCsrf", () => {
  const base = { method: "POST", pathname: "/api/equipment", appOrigin: APP };

  test("safe methods and non-API paths are not checked", () => {
    expect(checkCsrf({ ...base, method: "GET", headers: headers({ origin: "https://evil.com" }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, pathname: "/dashboard", headers: headers({}) }).ok).toBe(true);
  });

  test("same-origin Origin passes; foreign or null Origin fails", () => {
    expect(checkCsrf({ ...base, headers: headers({ origin: APP }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, headers: headers({ origin: "https://evil.com" }) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ origin: "null" }) }).ok).toBe(false);
    expect(
      checkCsrf({ ...base, headers: headers({ origin: APP, "sec-fetch-site": "cross-site" }) }).ok
    ).toBe(false);
  });

  test("Sec-Fetch-Site without Origin: same-origin/none pass, cross-site/same-site fail", () => {
    expect(checkCsrf({ ...base, headers: headers({ "sec-fetch-site": "same-origin" }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, headers: headers({ "sec-fetch-site": "none" }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, headers: headers({ "sec-fetch-site": "cross-site" }) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ "sec-fetch-site": "same-site" }) }).ok).toBe(false);
  });

  test("header-less requests need JSON or X-Requested-With (form-encodable types rejected)", () => {
    expect(checkCsrf({ ...base, headers: headers({}) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ "content-type": "text/plain" }) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ "content-type": "application/x-www-form-urlencoded" }) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ "content-type": "multipart/form-data; boundary=x" }) }).ok).toBe(false);
    expect(checkCsrf({ ...base, headers: headers({ "content-type": "application/json" }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, headers: headers({ "x-requested-with": "fetch" }) }).ok).toBe(true);
  });

  test("exemptions: auth, rsvp, and cron only with a secret header", () => {
    expect(checkCsrf({ ...base, pathname: "/api/auth/signin/google", headers: headers({}) }).ok).toBe(true);
    expect(checkCsrf({ ...base, pathname: "/api/rsvp", headers: headers({ origin: "https://mail.example" }) }).ok).toBe(true);
    expect(checkCsrf({ ...base, pathname: "/api/cron/reminders", headers: headers({ "x-cron-secret": "s" }) }).ok).toBe(true);
    expect(
      checkCsrf({ ...base, pathname: "/api/cron/reminders", headers: headers({ authorization: "Bearer s" }) }).ok
    ).toBe(true);
    // An admin session POST to cron (no secret) is CSRF-checked like everything else.
    expect(
      checkCsrf({ ...base, pathname: "/api/cron/reminders", headers: headers({ origin: "https://evil.com" }) }).ok
    ).toBe(false);
    expect(checkCsrf({ ...base, pathname: "/api/cron/reminders", headers: headers({}) }).ok).toBe(false);
  });
});

describe("getClientIp", () => {
  test("Vercel: trusts x-real-ip / x-vercel-forwarded-for, ignores spoofable headers", () => {
    const env = { VERCEL: "1" };
    const h = headers({
      "cf-connecting-ip": "6.6.6.6",
      "cf-ray": "abc",
      "x-forwarded-for": "6.6.6.6, 10.0.0.1",
      "x-real-ip": "1.2.3.4",
    });
    expect(detectPlatform(h, env)).toBe("vercel");
    expect(getClientIp(h, env)).toBe("1.2.3.4");
    expect(getClientIp(headers({ "x-vercel-forwarded-for": "5.6.7.8", "cf-connecting-ip": "6.6.6.6" }), env)).toBe(
      "5.6.7.8"
    );
  });

  test("Cloudflare (cf-ray, not Vercel): trusts cf-connecting-ip", () => {
    const h = headers({ "cf-ray": "abc-SIN", "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6" });
    expect(detectPlatform(h, {})).toBe("cloudflare");
    expect(getClientIp(h, {})).toBe("9.9.9.9");
  });

  test("elsewhere: cf-connecting-ip without cf-ray is ignored; last x-forwarded-for hop is used", () => {
    const h = headers({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 7.7.7.7, 8.8.8.8" });
    expect(detectPlatform(h, {})).toBe("other");
    expect(getClientIp(h, {})).toBe("8.8.8.8");
  });

  test("garbage or missing values → unknown", () => {
    expect(getClientIp(headers({}), {})).toBe("unknown");
    expect(getClientIp(headers({ "x-forwarded-for": "not-an-ip<script>" }), {})).toBe("unknown");
    expect(getClientIp(headers({ "x-forwarded-for": "2001:db8::1" }), {})).toBe("2001:db8::1");
  });
});

describe("rate limit keys & buckets", () => {
  beforeEach(() => resetRateLimits());

  test("authenticated requests are keyed by user, anonymous by IP", () => {
    expect(getRateLimitKey("api", { userId: "42", ip: "1.1.1.1" })).toBe("api:user:42");
    expect(getRateLimitKey("api", { userId: null, ip: "1.1.1.1" })).toBe("api:ip:1.1.1.1");
    expect(getRateLimitKey("auth", { ip: "1.1.1.1" })).toBe("auth:ip:1.1.1.1");
    expect(getRateLimitKey("api", { ip: "unknown" })).toBe("api:unknown");
  });

  test("students behind one NAT IP get separate buckets", () => {
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit(getRateLimitKey("api", { userId: "1", ip: "10.0.0.1" }), limit, 60_000)).toBe(true);
    }
    expect(checkRateLimit(getRateLimitKey("api", { userId: "1", ip: "10.0.0.1" }), limit, 60_000)).toBe(false);
    // Another signed-in student on the same IP is unaffected.
    expect(checkRateLimit(getRateLimitKey("api", { userId: "2", ip: "10.0.0.1" }), limit, 60_000)).toBe(true);
  });

  test("the unknown bucket gets a looser limit; auth has its own generous buckets", () => {
    expect(limitFor("api", "api:unknown")).toBeGreaterThan(RATE_LIMITS.api);
    expect(limitFor("api", "api:ip:1.1.1.1")).toBe(RATE_LIMITS.api);
    expect(RATE_LIMITS.auth).toBeGreaterThanOrEqual(RATE_LIMITS.api);
    expect(RATE_LIMITS["auth-read"]).toBeGreaterThan(RATE_LIMITS.auth);
  });

  test("Map order tracks recency (LRU-ish)", () => {
    checkRateLimit("a", 100, 60_000);
    checkRateLimit("b", 100, 60_000);
    checkRateLimit("c", 100, 60_000);
    checkRateLimit("a", 100, 60_000); // touch "a"
    expect(rateLimitKeys()).toEqual(["b", "c", "a"]);
  });
});

describe("middleware wiring", () => {
  let middleware: (req: NextRequest, ctx?: unknown) => Promise<Response>;

  beforeAll(async () => {
    middleware = (await import("@/middleware")).default as typeof middleware;
  });

  beforeEach(() => {
    resetRateLimits();
    mockSession = null;
  });

  test("header-less cross-site-able POST is rejected; JSON POST reaches auth gating", async () => {
    const formLike = await middleware(new NextRequest(`${APP}/api/equipment`, { method: "POST", body: "a=b" }));
    expect(formLike.status).toBe(403);
    expect((await formLike.json()).error).toBe(CSRF_ERROR_MESSAGE);

    const json = await middleware(
      new NextRequest(`${APP}/api/equipment`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
    );
    expect(json.status).toBe(401); // not signed in
  });

  test("no role gating in middleware: a viewer JWT reaches admin API routes (handlers re-check the DB role)", async () => {
    mockSession = { user: { id: "7", email: "v@x.y", role: "viewer" } };
    const res = await middleware(new NextRequest(`${APP}/api/reservations`, { headers: { origin: APP } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");

    const page = await middleware(new NextRequest(`${APP}/dashboard/users`));
    expect(page.status).toBe(200);
  });

  test("signed-in users are rate limited per user, not per shared IP", async () => {
    const ipHeaders = { "x-forwarded-for": "203.0.113.9" };
    mockSession = { user: { id: "1", email: "a@x.y", role: "verified" } };
    for (let i = 0; i < RATE_LIMITS.api; i++) {
      expect((await middleware(new NextRequest(`${APP}/api/equipment`, { headers: ipHeaders }))).status).toBe(200);
    }
    expect((await middleware(new NextRequest(`${APP}/api/equipment`, { headers: ipHeaders }))).status).toBe(429);

    mockSession = { user: { id: "2", email: "b@x.y", role: "verified" } };
    expect((await middleware(new NextRequest(`${APP}/api/equipment`, { headers: ipHeaders }))).status).toBe(200);
  });

  test("API traffic cannot exhaust the auth bucket for the same IP", async () => {
    const ipHeaders = { "x-forwarded-for": "198.51.100.4" };
    for (let i = 0; i < RATE_LIMITS.api; i++) {
      await middleware(new NextRequest(`${APP}/api/equipment`, { headers: ipHeaders }));
    }
    expect((await middleware(new NextRequest(`${APP}/api/equipment`, { headers: ipHeaders }))).status).toBe(429);
    const login = await middleware(new NextRequest(`${APP}/api/auth/signin/google`, { method: "POST", headers: ipHeaders }));
    expect(login.status).toBe(200);
  });

  test("sign-out is never rate limited", async () => {
    const ipHeaders = { "x-forwarded-for": "198.51.100.5" };
    for (let i = 0; i < RATE_LIMITS.auth + 5; i++) {
      await middleware(new NextRequest(`${APP}/api/auth/callback/google`, { headers: ipHeaders }));
    }
    expect((await middleware(new NextRequest(`${APP}/api/auth/callback/google`, { headers: ipHeaders }))).status).toBe(429);
    expect((await middleware(new NextRequest(`${APP}/api/auth/signout`, { method: "POST", headers: ipHeaders }))).status).toBe(200);
  });
});
