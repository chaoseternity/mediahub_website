"use client";

import { useEffect, useState } from "react";

/**
 * Current time in ms, or null during SSR and the first client render (so server and client
 * markup match). Updates every `intervalMs` after mount. Use for "now"-dependent UI such as
 * overdue flags, relative times and "today" highlights.
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (intervalMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
