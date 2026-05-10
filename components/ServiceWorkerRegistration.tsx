"use client";
import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) on mount. The SW caches
 * static assets + last-known HTML pages so installed-PWA users on the
 * course with bad service still see the app shell.
 *
 * Skipped in dev (next dev) because Next.js's dev server already
 * serves with no-cache headers and SW interaction adds noise. Also
 * skipped on browsers without service-worker support.
 *
 * Per CLAUDE.md "PWA reliability" priority. Score-write resilience
 * is handled separately by lib/useScoreSaver.ts which queues writes
 * in localStorage and drains on reconnect.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // SW registration failures are non-critical — the app works
          // fine without it, just no offline shell.
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
