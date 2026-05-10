import Link from "next/link";

/**
 * Persistent header for any /rounds/[id]/<sub-page> screen — score,
 * score-group, finalize, games, wagers, invites, upload, join.
 *
 * Why: per Patrick (2026-05-10) "the user should never feel lost." Every
 * round sub-page should make it obvious which round the user is in and
 * give a one-tap path back to the round home. Without this, a player
 * who deep-links into /score-group can't easily get back to the
 * leaderboard or finalize flow.
 *
 * Pure props — caller (each sub-page server component) passes the round
 * fields it already fetched, so this adds no extra DB queries.
 *
 * The breadcrumb is also distinct from the floating ActiveRoundPill:
 * the pill links to the user's *current* live round from anywhere in
 * the app; the breadcrumb confirms which round you're inside right now.
 */
export type RoundStatus = "draft" | "live" | "pending_finalization" | "finalized";

/** Human-friendly label + tailwind class pair for any round status.
 *  Centralized here so the dashboard, breadcrumb, admin views, and
 *  spectator chrome all read the same way for the same DB state. */
export function statusPillFor(status: RoundStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "live":
      return { label: "live", className: "pill-live" };
    case "finalized":
      return { label: "final", className: "pill-final" };
    case "pending_finalization":
      // Soft amber rather than green-live or cream-final — visually
      // signals "not active, not locked, awaiting commissioner."
      return {
        label: "awaiting finalization",
        className:
          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
      };
    case "draft":
    default:
      return { label: "draft", className: "pill-draft" };
  }
}

export function RoundBreadcrumb({
  roundId,
  courseName,
  date,
  status,
  /**
   * Optional. The page name shown after the course/date (e.g. "Score
   * entry", "Wagers", "Invites"). Lets the breadcrumb double as a
   * single-line page header so the sub-page can drop its own h1 below.
   */
  page
}: {
  roundId: string;
  courseName: string | null;
  date: string;
  status: RoundStatus;
  page?: string;
}) {
  const pill = statusPillFor(status);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <Link
        href={`/rounds/${roundId}`}
        prefetch={false}
        className="btn-ghost text-xs inline-flex items-center gap-1.5 truncate"
        aria-label={`Back to round at ${courseName ?? "course"}`}
      >
        <span aria-hidden="true">←</span>
        <span className="truncate">
          <span className="text-cream-50 font-medium">
            {courseName ?? "Round"}
          </span>
          <span className="text-cream-100/55"> · {date}</span>
          {page && (
            <span className="text-cream-100/45 hidden sm:inline">
              {" · "}
              {page}
            </span>
          )}
        </span>
      </Link>
      <span className={`${pill.className} text-[10px] shrink-0`}>
        {pill.label}
      </span>
    </div>
  );
}
