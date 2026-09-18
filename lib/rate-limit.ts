/**
 * Sliding window rate limiter using in-process memory.
 *
 * Each entry is: ip → array of request timestamps within the current window.
 * Old timestamps are pruned on every request for that IP.
 * A periodic sweep removes entries for IPs that have gone idle.
 *
 * Cloudflare Workers note: each Worker isolate has its own Map, so limits are
 * per-instance rather than globally enforced. This is acceptable for an
 * internal app; upgrade to Cloudflare WAF Rate Limiting Rules for global enforcement.
 */

const store = new Map<string, number[]>();

// Sweep idle entries every 5 minutes so the Map doesn't grow forever in long-lived
// processes (local dev). In Cloudflare Workers, isolates are short-lived anyway.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const cutoff = Date.now() - SWEEP_INTERVAL_MS;
    for (const [ip, timestamps] of store) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
        store.delete(ip);
      }
    }
  }, SWEEP_INTERVAL_MS);
  if (timer && typeof (timer as any).unref === "function") {
    (timer as any).unref();
  }
}

/**
 * Returns true if the request is allowed, false if the rate limit is exceeded.
 *
 * @param ip       - Client IP identifier
 * @param limit    - Maximum number of requests allowed in the window
 * @param windowMs - Rolling window duration in milliseconds
 */
const MAX_ENTRIES = 10_000;

let lastSweepTime = Date.now();

export function checkRateLimit(rawIp: string, limit: number, windowMs: number): boolean {
  const ip = (rawIp || "unknown").trim().slice(0, 64) || "unknown";
  const now = Date.now();
  const windowStart = now - windowMs;

  // Lazy sweep on active requests for serverless/edge environments where setInterval is frozen
  if (now - lastSweepTime > SWEEP_INTERVAL_MS) {
    lastSweepTime = now;
    const cutoff = now - SWEEP_INTERVAL_MS;
    for (const [key, timestamps] of store) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
        store.delete(key);
      }
    }
  }

  const timestamps = (store.get(ip) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    // Still store the pruned list so the next sweep can clean it up correctly
    store.set(ip, timestamps);
    return false;
  }

  // Evict oldest entry if maximum capacity is reached
  if (!store.has(ip) && store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }

  timestamps.push(now);
  store.set(ip, timestamps);
  return true;
}
