/**
 * Browser helpers for talking to the service worker (public/sw.js).
 */

/** Page-cache names (current and legacy) that may hold user-specific HTML. */
function isUserPageCache(name: string): boolean {
  return name.startsWith("mediahub-station") && !name.includes("-static-");
}

/**
 * Clears cached pages so the next user of a shared device cannot see them offline.
 * Call on sign-out, before signOut(). Never throws; no-op during SSR.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const controller = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
    controller?.postMessage({ type: "CLEAR_USER_CACHE" });
  } catch (err) {
    console.warn("[PWA] Could not notify service worker to clear caches:", err);
  }

  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.filter(isUserPageCache).map((key) => caches.delete(key)));
  } catch (err) {
    console.warn("[PWA] Could not clear page caches:", err);
  }
}
