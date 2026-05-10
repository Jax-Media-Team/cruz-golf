"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Floating "Back to round" pill — appears whenever there's a live round
 * and the user isn't already looking at it. Designed to be discreet:
 *
 *  - Hidden on /dashboard (the dashboard has its own active-round hero
 *    card, so the floating pill would just overlap the rounds list).
 *  - Hidden on the round itself, on score-group / score / wagers /
 *    invites / finalize / games sub-pages, and on /demo.
 *  - Right-aligned on every viewport, sized to one short line.
 *  - Has an inline "×" so the user can dismiss it for the session.
 *  - Sits clear of the mobile bottom nav (bottom-20 + safe-area).
 */

const DISMISS_KEY = "cruz-golf:activeRoundPill:dismissed";

export function ActiveRoundPill({
  roundId,
  courseName
}: {
  roundId: string | null;
  courseName: string | null;
}) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Persist dismissal per-round so a different round resurfaces the pill.
  useEffect(() => {
    if (!roundId) return;
    if (typeof window === "undefined") return;
    try {
      const v = window.sessionStorage.getItem(DISMISS_KEY);
      if (v === roundId) setDismissed(true);
      else setDismissed(false);
    } catch {
      /* sessionStorage unavailable — fine */
    }
  }, [roundId]);

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, roundId ?? "");
    } catch {
      /* ignore */
    }
  }

  if (!roundId || dismissed) return null;

  // Pages that should NEVER show the floating pill.
  const path = pathname ?? "";
  const isHiddenRoute =
    path === "/dashboard" || // has its own hero card
    path === "/" ||
    path.startsWith(`/rounds/${roundId}`) || // already on the round
    path.startsWith("/demo") ||
    path.startsWith("/admin"); // admin has its own deep nav
  if (isHiddenRoute) return null;

  return (
    <div
      // Right-aligned, doesn't full-width across mobile so cards stay tappable
      // anywhere except the corner. bottom-20 clears the 5-tab mobile nav;
      // safe-area pads notched iPhones; sm:bottom-6 docks it lower on desktop
      // where the bottom-nav doesn't exist.
      className="fixed right-3 z-40 pointer-events-none flex justify-end sm:right-4"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="pointer-events-auto inline-flex items-stretch overflow-hidden rounded-full bg-gold-500 text-brand-900 shadow-2xl text-xs font-medium">
        <Link
          href={`/rounds/${roundId}`}
          className="px-3 py-2 inline-flex items-center gap-2 hover:brightness-110 transition-all"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-pulse" />
          <span className="truncate max-w-[14ch]">
            Live · {courseName ?? "Round"}
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="px-2 border-l border-brand-900/20 hover:bg-brand-900/15"
          aria-label="Dismiss live round pill"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
