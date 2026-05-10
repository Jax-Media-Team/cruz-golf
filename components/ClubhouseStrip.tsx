import Link from "next/link";
import {
  fmtMoneyCents,
  fmtRelativeToPar,
  type ClubhouseBundle
} from "@/lib/clubhouse";

/**
 * The "living clubhouse" surface on the dashboard. Group-centric activity:
 * who's playing right now, who's on a streak, what your group has been
 * doing this month.
 *
 * Per Patrick (2026-05-10): "private golf crew · 'our group lives here'",
 * NOT "public golf influencer feed". Every signal here is derived from
 * data the user's group already owns. No global activity, no algorithmic
 * discovery, no strangers.
 *
 * The component renders nothing if there's nothing meaningful to show
 * (no live rounds, no streaks, no activity in the window) — it should
 * never be a half-empty card just for the sake of being there.
 */
export function ClubhouseStrip({ bundle }: { bundle: ClubhouseBundle }) {
  const hasLive = bundle.live_rounds.length > 0;
  const hasStreak = bundle.streaks.length > 0;
  const hasActivity =
    bundle.activity.rounds_recent > 0 ||
    bundle.activity.cents_moved_recent > 0 ||
    bundle.activity.top_course != null;

  if (!hasLive && !hasStreak && !hasActivity) return null;

  return (
    <section className="space-y-2">
      <p className="h-eyebrow text-gold-400">In your clubhouse</p>

      {/* Live rounds — the loudest signal. */}
      {hasLive && (
        <ul className="space-y-2">
          {bundle.live_rounds.map((lr) => {
            const url = lr.spectator_token
              ? `/rounds/${lr.round_id}/leaderboard?token=${lr.spectator_token}`
              : `/rounds/${lr.round_id}`;
            const leaderText = lr.leader
              ? `${lr.leader.display_name} ${fmtRelativeToPar(
                  lr.leader.relative_to_par
                )} thru ${lr.leader.thru}`
              : "warming up";
            return (
              <Link
                key={lr.round_id}
                href={url}
                prefetch={false}
                className="card card-hover p-4 flex items-center justify-between gap-3 border border-emerald-400/30 bg-brand-900/40 hover:bg-brand-900/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <div className="min-w-0">
                    <div className="font-serif text-base text-cream-50 truncate">
                      🟢 {leaderText}
                    </div>
                    <div className="text-xs text-cream-100/55 truncate">
                      {lr.course_name} · {lr.active_players}/
                      {lr.total_players} scoring
                    </div>
                  </div>
                </div>
                <span className="pill bg-emerald-500/20 text-emerald-300 text-[10px] hidden sm:inline-flex">
                  Watch →
                </span>
              </Link>
            );
          })}
        </ul>
      )}

      {/* Streaks + activity in a compact two-up grid. */}
      {(hasStreak || hasActivity) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {hasStreak && bundle.streaks[0] && (
            <div className="card p-3 flex items-center gap-3">
              <span className="text-xl shrink-0" aria-hidden="true">
                🔥
              </span>
              <div className="min-w-0 text-sm">
                <div className="font-medium text-cream-50 truncate">
                  {bundle.streaks[0].display_name} on a{" "}
                  {bundle.streaks[0].consecutive_wins}-round heater
                </div>
                <div className="text-[11px] text-cream-100/55">
                  {fmtMoneyCents(bundle.streaks[0].total_cents)} won across the
                  streak
                </div>
              </div>
            </div>
          )}

          {hasActivity && (
            <div className="card p-3 flex items-center gap-3">
              <span className="text-xl shrink-0" aria-hidden="true">
                📅
              </span>
              <div className="min-w-0 text-sm">
                <div className="font-medium text-cream-50 truncate">
                  {bundle.activity.rounds_recent} round
                  {bundle.activity.rounds_recent === 1 ? "" : "s"} ·{" "}
                  {fmtMoneyCents(bundle.activity.cents_moved_recent)} moved
                </div>
                <div className="text-[11px] text-cream-100/55 truncate">
                  Last {bundle.activity.window_days} days in {bundle.group_name}
                  {bundle.activity.top_course
                    ? ` · ${bundle.activity.top_course.name} (${bundle.activity.top_course.rounds})`
                    : ""}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
