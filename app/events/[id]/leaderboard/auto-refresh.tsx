"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls router.refresh() on a fixed interval. Used by the spectator
 * surface because anon clients can't subscribe to postgres_changes
 * via RLS (the realtime channel silently no-ops for them). Server
 * component re-renders pull fresh data through supabaseAdmin.
 *
 * 25s default matches the "feels live" threshold without hammering
 * the server. Pauses when the tab isn't visible to avoid wasted
 * fetches on backgrounded tabs.
 */
export function SpectatorAutoRefresh({
  intervalSeconds = 25
}: {
  intervalSeconds?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    function tick() {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }
    const handle = setInterval(tick, intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [intervalSeconds, router]);
  return null;
}
