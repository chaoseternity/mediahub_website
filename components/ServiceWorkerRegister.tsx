"use client";

import { useEffect } from "react";

function registerServiceWorker() {
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      console.log("[PWA] Service Worker registered with scope:", reg.scope);
    })
    .catch((err) => {
      console.warn("[PWA] Service Worker registration failed:", err);
    });
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }

    // The load event may already have fired before hydration; register right away in that case.
    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }

    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  return null;
}
