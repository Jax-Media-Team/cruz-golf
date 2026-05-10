"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

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
 *
 * Amber alert state: when the viewer has a pending press awaiting their
 * response on the live round, the pill flips amber and says "Press
 * pending · [course]". Realtime updates via `postgres_changes` on
 * round_presses so a press opened from another device surfaces within
 * seconds without a page reload.
 *
 * Tone: statement, not exclamation. "Press pending" is the data; the
 * amber color is the alert. No badges, no fire emoji.
 */

const DISMISS_KEY = "cruz-golf:activeRoundPill:dismissed";

export function ActiveRoundPill({
  roundId,
  courseName,
  myRpId,
  initialPendingPressCount = 0
}: {
  roundId: string | null;
  courseName: string | null;
  myRpId?: string | null;
  initialPendingPressCount?: number;
}) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [pressPendingCount, setPressPendingCount] = useState(
    initialPendingPressCount
  );

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

  // Reset local press count whenever the server-provided initial value
  // changes (e.g. navigation to a new page re-runs the layout fetch).
  useEffect(() => {
    setPressPendingCount(initialPendingPressCount);
  }, [initialPendingPressCount]);

  // Realtime subscription: keep the press-pending count fresh while the
  // user lingers on a non-round page. Filtered by round_id; we recount
  // from the DB on each event because press status changes (accept /
  // decline / withdraw / expire) can flip the count down as well as up.
  // 60s safety-net refetch covers silent socket drops, matching the
  // pattern in round-view.tsx and press-controls.tsx.
  useEffect(() => {
    if (!roundId || !myRpId) return;
    const sb = supabaseBrowser();
    let cancelled = false;

    async function refetchCount() {
      const cutoff = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();
      const { count } = await sb
        .from("round_presses")
        .select("id", { count: "exact", head: true })
        .eq("round_id", roundId!)
        .eq("status", "pending")
        .gte("opened_at", cutoff)
        .contains("side_b_rp_ids", [myRpId!]);
      if (!cancelled) setPressPendingCount(count ?? 0);
    }

    const channel = sb
      .channel(`pill-${roundId}-presses`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_presses",
          filter: `round_id=eq.${roundId}`
        },
        () => {
          if (!cancelled) refetchCount();
        }
      )
      .subscribe();

    const interval = setInterval(refetchCount, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      sb.removeChannel(channel);
    };
  }, [roundId, myRpId]);

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

  // Alert state when there's a pending press awaiting the viewer's
  // response. Amber instead of gold; the indicator dot shifts to amber
  // pulse; label becomes "Press pending · [course]".
  const alert = pressPendingCount > 0;

  const surfaceClass = alert
    ? "bg-amber-400 text-brand-900"
    : "bg-gold-500 text-brand-900";
  const dotClass = alert
    ? "bg-amber-700 animate-pulse"
    : "bg-emerald-700 animate-pulse";
  const dividerClass = alert
    ? "border-l border-amber-800/30 hover:bg-amber-800/15"
    : "border-l border-brand-900/20 hover:bg-brand-900/15";

  return (
    <div
      // Right-aligned, doesn't full-width across mobile so cards stay tappable
      // anywhere except the corner. bottom-20 clears the 5-tab mobile nav;
      // safe-area pads notched iPhones; sm:bottom-6 docks it lower on desktop
      // where the bottom-nav doesn't exist.
      className="fixed right-3 z-40 pointer-events-none flex justify-end sm:right-4"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        className={`pointer-events-auto inline-flex items-stretch overflow-hidden rounded-full shadow-2xl text-xs font-medium ${surfaceClass}`}
      >
        <Link
          href={`/rounds/${roundId}`}
          className="px-3 py-2 inline-flex items-center gap-2 hover:brightness-110 transition-all"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          <span className="truncate max-w-[18ch]">
            {alert
              ? `Press pending · ${courseName ?? "Round"}`
              : `Live · ${courseName ?? "Round"}`}
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className={`px-2 ${dividerClass}`}
          aria-label="Dismiss live round pill"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
