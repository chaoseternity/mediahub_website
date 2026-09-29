/**
 * Request-level security helpers shared by middleware and route handlers.
 * Edge/Workers-safe: no Node-only APIs (no `crypto.timingSafeEqual`).
 */

const encoder = new TextEncoder();

/**
 * Constant-time string comparison (for secrets such as CRON_SECRET).
 *
 * Both strings are UTF-8 encoded and compared byte-by-byte with an XOR accumulator, always
 * walking the full length of the longer input, so the running time does not depend on where
 * the first mismatch is. A length mismatch still returns false (the length itself is not
 * treated as secret).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    // Out-of-range reads yield undefined → 0; the length XOR above already records the mismatch.
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export const CSRF_ERROR_MESSAGE = "Forbidden: Cross-site requests are not allowed";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfDecision = { ok: true } | { ok: false; reason: string };

/**
 * CSRF policy for mutating API requests (POST/PUT/PATCH/DELETE to /api/*).
 *
 * Exempt:
 * - /api/auth/*  — NextAuth has its own double-submit CSRF token.
 * - /api/rsvp    — public, authorised only by the unguessable token in the body (no cookies).
 * - /api/cron/*  — only when the request carries the cron secret header (Authorization: Bearer
 *   or x-cron-secret); the route verifies the secret. A cross-site form can't set these headers.
 *   Admin-session requests to /api/cron/* are checked like any other mutation.
 *
 * Everything else must satisfy one of:
 * 1. `Origin` is present: it must equal the app's own origin (`null` is rejected).
 * 2. No `Origin`, but `Sec-Fetch-Site` is present: it must be `same-origin` or `none`
 *    (`none` = user-initiated, e.g. typed URL/bookmark; `same-site` is rejected because a
 *    sibling subdomain is a different trust domain).
 * 3. Neither header is present. Modern browsers always send `Origin` on cross-origin (and
 *    same-origin) POST/PUT/PATCH/DELETE and send `Sec-Fetch-Site` everywhere, so a header-less
 *    request is a non-browser client (curl, scripts, tests) or a very old browser. For those we
 *    require a Content-Type that an HTML form cannot produce (`application/json`) or the
 *    `X-Requested-With` custom header — both force a CORS preflight when sent cross-site.
 *    multipart/form-data and x-www-form-urlencoded are NOT accepted here because a plain
 *    cross-site HTML form can send them; the app's own FormData uploads come from `fetch`,
 *    which always includes `Origin`, so they are covered by rule 1.
 */
export function checkCsrf(input: {
  method: string;
  pathname: string;
  appOrigin: string;
  headers: Headers;
}): CsrfDecision {
  const { method, pathname, appOrigin, headers } = input;
  if (!MUTATING_METHODS.has(method.toUpperCase())) return { ok: true };
  if (!pathname.startsWith("/api/")) return { ok: true };
  if (pathname.startsWith("/api/auth/")) return { ok: true };
  if (pathname === "/api/rsvp" || pathname.startsWith("/api/rsvp/")) return { ok: true };
  if (pathname.startsWith("/api/cron/") || pathname === "/api/cron") {
    const hasSecretHeader =
      (headers.get("authorization") ?? "").startsWith("Bearer ") || headers.has("x-cron-secret");
    if (hasSecretHeader) return { ok: true };
  }

  const origin = headers.get("origin");
  if (origin !== null) {
    if (origin === "null" || origin !== appOrigin) {
      return { ok: false, reason: "origin mismatch" };
    }
    // Origin matches; still honour an explicit cross-site signal from the browser.
    if (headers.get("sec-fetch-site") === "cross-site") {
      return { ok: false, reason: "sec-fetch-site cross-site" };
    }
    return { ok: true };
  }

  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    return secFetchSite === "same-origin" || secFetchSite === "none"
      ? { ok: true }
      : { ok: false, reason: `sec-fetch-site ${secFetchSite}` };
  }

  // Header-less (non-browser) client.
  const contentType = (headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("application/json") || contentType.includes("+json")) return { ok: true };
  if (headers.has("x-requested-with")) return { ok: true };
  return { ok: false, reason: "missing origin headers" };
}
