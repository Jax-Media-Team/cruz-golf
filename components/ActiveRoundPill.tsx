"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Floating "Back to round" pill — appears whenever there's a live round
 * and the user is not already on that round's page (or on /demo).
 *
 * Sits above the mobile bottom nav using bottom-20 + safe-area, and to the
 * right on desktop where the bottom nav doesn't exist.
 */
export function ActiveRoundPill({
  roundId,
  courseName
}: {
  roundId: string | null;
  courseName: string | null;
}) {
  const pathname = usePathname();
  if (!roundId) return null;

  // Don't show on the round itself, the score-pad, or demo pages — those
  // already have their own CTAs.
  const isOnThisRound =
    pathname?.startsWith(`/rounds/${roundId}`) ||
    pathname?.startsWith("/demo");
  if (isOnThisRound) return null;

  return (
    <div
      className="fixed inset-x-0 z-40 px-3 pointer-events-none flex justify-center sm:justify-end sm:right-4 sm:left-auto sm:px-0"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <Link
        href={`/rounds/${roundId}`}
        className="pointer-events-auto pill bg-gold-500 text-brand-900 shadow-2xl text-sm px-4 py-2 inline-flex items-center gap-2 font-medium hover:brightness-110 transition-all"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-pulse" />
        <span className="truncate max-w-[18ch]">
          Live · {courseName ?? "Round"}
        </span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
