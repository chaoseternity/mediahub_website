/**
 * Sliding-window rate limiter using in-process memory.
 *
 * Each entry is: key → array of request timestamps within the current window.
 * Old timestamps are pruned on every request for that key, and idle keys are swept.
 *
 * Per-isolate: every Cloudflare Worker isolate / serverless instance has its own Map, so limits
 * are enforced per instance rather than globally. That is acceptable for this internal app; use
 * Cloudflare WAF Rate Limiting Rules (or a Durable Object / KV counter) for global enforcement.
 *
 * Keys are namespaced by the caller (see `getRateLimitKey`): authenticated requests are keyed by
 * user so the many students behind one school NAT IP don't share a bucket; anonymous requests
 * are keyed by client IP.
 */

const store = new Map<string, number[]>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const MAX_KEY_LENGTH = 128;

let lastSweepTime = Date.now();

function sweep(now: number) {
  const cutoff = now - SWEEP_INTERVAL_MS;
  for (const [key, timestamps] of store) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
      store.delete(key);
    }
  }
}

// Sweep idle entries every 5 minutes so the Map doesn't grow forever in long-lived
// processes (local dev). In Workers, timers are frozen between requests, so a lazy sweep
// also runs from checkRateLimit.
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => sweep(Date.now()), SWEEP_INTERVAL_MS);
  if (timer && typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

/**
 * Returns true if the request is allowed, false if the rate limit is exceeded.
 *
 * @param rawKey   - Bucket key (e.g. "ip:1.2.3.4" or "user:42"); oversized keys are truncated
 * @param limit    - Maximum number of requests allowed in the window
 * @param windowMs - Rolling window duration in milliseconds
 */
export function checkRateLimit(rawKey: string, limit: number, windowMs: number): boolean {
  const key = (rawKey || "unknown").trim().slice(0, MAX_KEY_LENGTH) || "unknown";
  const now = Date.now();
  const windowStart = now - windowMs;

  // Lazy sweep for serverless/edge environments where setInterval is frozen.
  if (now - lastSweepTime > SWEEP_INTERVAL_MS) {
    lastSweepTime = now;
    sweep(now);
  }

  const existing = store.get(key);
  const timestamps = (existing ?? []).filter((t) => t > windowStart);

  // LRU-ish ordering: delete and re-insert on every access so the Map's insertion order is
  // recency order, and eviction below removes the least recently used key.
  if (existing) store.delete(key);

  if (timestamps.length >= limit) {
    store.set(key, timestamps);
    return false;
  }

  if (!existing && store.size >= MAX_ENTRIES) {
    const lruKey = store.keys().next().value;
    if (lruKey !== undefined) store.delete(lruKey);
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return true;
}

/** Test helper: clears all buckets. */
export function resetRateLimits(): void {
  store.clear();
  lastSweepTime = Date.now();
}

/** Test/diagnostic helper: the keys currently tracked, least recently used first. */
export function rateLimitKeys(): string[] {
  return Array.from(store.keys());
}

// ---------------------------------------------------------------------------
// Client identification
// ---------------------------------------------------------------------------

export type Platform = "cloudflare" | "vercel" | "other";

/**
 * Which proxy headers can be trusted depends on where we run:
 * - Vercel: `x-real-ip` / `x-vercel-forwarded-for` are set by Vercel's edge and overwrite any
 *   client-supplied value; `cf-connecting-ip` and the first `x-forwarded-for` entry are
 *   client-controlled there.
 * - Cloudflare (Workers): `cf-connecting-ip` is set by Cloudflare (a `cf-ray` header is always
 *   present). Detected by `cf-ray` AND not running on Vercel.
 * - Anything else: only the LAST `x-forwarded-for` hop (appended by the nearest proxy) is
 *   meaningful; earlier hops are client-controlled.
 */
export function detectPlatform(headers: Headers, env: { VERCEL?: string } = readEnv()): Platform {
  if (env.VERCEL) return "vercel";
  if (headers.has("cf-ray")) return "cloudflare";
  return "other";
}

function readEnv(): { VERCEL?: string } {
  try {
    return { VERCEL: typeof process !== "undefined" ? process.env?.VERCEL : undefined };
  } catch {
    return {};
  }
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function cleanIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ip = value.trim();
  return IP_RE.test(ip) ? ip : null;
}

function lastForwardedHop(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return cleanIp(parts[parts.length - 1]);
}

/** Best-effort client IP for rate limiting, or "unknown". */
export function getClientIp(headers: Headers, env: { VERCEL?: string } = readEnv()): string {
  const platform = detectPlatform(headers, env);

  if (platform === "vercel") {
    const vercelIp =
      cleanIp(headers.get("x-real-ip")) ??
      cleanIp(headers.get("x-vercel-forwarded-for")?.split(",")[0]);
    return vercelIp ?? lastForwardedHop(headers) ?? "unknown";
  }

  if (platform === "cloudflare") {
    const cfIp = cleanIp(headers.get("cf-connecting-ip"));
    return cfIp ?? lastForwardedHop(headers) ?? "unknown";
  }

  return lastForwardedHop(headers) ?? "unknown";
}

/** Small non-cryptographic hash (FNV-1a, 32-bit) for bucketing opaque values. */
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type RateLimitBucket = "api" | "auth" | "auth-read";

/**
 * Builds the bucket key for a request.
 * - Authenticated (verified session user id available): `<bucket>:user:<id>` — students behind
 *   the same school NAT each get their own bucket.
 * - Anonymous with a known IP: `<bucket>:ip:<ip>`.
 * - Neither: `<bucket>:unknown` (callers should apply a looser limit, see `limitFor`).
 */
export function getRateLimitKey(
  bucket: RateLimitBucket,
  identity: { userId?: string | number | null; ip: string }
): string {
  const userId = identity.userId === undefined || identity.userId === null ? "" : String(identity.userId).trim();
  if (userId) return `${bucket}:user:${userId.slice(0, 64)}`;
  if (identity.ip && identity.ip !== "unknown") return `${bucket}:ip:${identity.ip}`;
  return `${bucket}:unknown`;
}

/** Per-minute limits. */
export const RATE_LIMITS = {
  /** General API/page traffic, per user (or per IP when anonymous). */
  api: 120,
  /** Sign-in / callback / sign-out-free auth actions, per IP (generous for a shared school NAT). */
  auth: 200,
  /** Session/csrf/providers reads, polled by the client, per IP. */
  "auth-read": 600,
} as const satisfies Record<RateLimitBucket, number>;

/**
 * The "unknown" bucket (no user, no identifiable IP — e.g. local dev without a proxy) would
 * otherwise be shared by every such client, so it gets a much looser limit.
 */
export const UNKNOWN_LIMIT_MULTIPLIER = 10;

export function limitFor(bucket: RateLimitBucket, key: string): number {
  const base = RATE_LIMITS[bucket];
  return key.endsWith(":unknown") ? base * UNKNOWN_LIMIT_MULTIPLIER : base;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;
