"use client";
/**
 * Watches for new deploys without disrupting active users.
 *
 * - Captures the build SHA the client loaded with on first mount.
 * - Polls /api/version every 60s (cheap edge route, short cache).
 * - When the server reports a different buildId, surfaces an "update
 *   available" state. We never force a reload — pending score writes are
 *   already durable via the localStorage queue, so the user can refresh
 *   on their own time without losing work.
 *
 * Pause polling when the tab is hidden to avoid waking up a phone in a
 * cart pocket, and re-check immediately on visibility/online.
 */
import { useEffect, useRef, useState } from "react";

const POLL_MS = 60_000;
const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function useVersionWatch() {
  const [latest, setLatest] = useState<string>(CURRENT_BUILD);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (CURRENT_BUILD === "dev") return; // no-op in local dev

    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { buildId?: string };
        if (json.buildId && json.buildId !== CURRENT_BUILD) {
          setLatest(json.buildId);
          stoppedRef.current = true; // stop polling once we know there's an update
          return;
        }
      } catch {
        /* network blip — ignore, try again on the next tick */
      }
      schedule();
    }

    function schedule() {
      if (stoppedRef.current) return;
      timer = setTimeout(check, POLL_MS);
    }

    function onVisibility() {
      if (document.visibilityState === "visible" && !stoppedRef.current) {
        if (timer) clearTimeout(timer);
        void check();
      }
    }

    function onFocus() {
      if (!stoppedRef.current) {
        if (timer) clearTimeout(timer);
        void check();
      }
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, []);

  return {
    current: CURRENT_BUILD,
    latest,
    updateAvailable: latest !== CURRENT_BUILD
  };
}
