"use client";
import { useEffect, useState } from "react";

/**
 * Shows a small, calm banner when the device is offline. Per CLAUDE.md
 * tone discipline: statement, not exclamation. The user already knows
 * something's wrong (they can see they have no signal); the banner
 * just confirms the app noticed and reassures them score writes will
 * sync when reconnected.
 *
 * Score-write resilience itself is handled by lib/useScoreSaver.ts
 * which queues writes in localStorage and drains on reconnect. This
 * component is purely a status indicator.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      // top is padded for env(safe-area-inset-top) so the iPhone
      // PWA status bar / Dynamic Island doesn't overlap the pill.
      // The base offset of 0.5rem (top-2 = 8px) is kept on top of
      // the safe-area inset.
      className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      style={{ top: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/40 px-3 py-1.5 text-xs backdrop-blur shadow-lg">
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber-400"
          aria-hidden="true"
        />
        <span>Offline · scores will sync when you reconnect</span>
      </div>
    </div>
  );
}
