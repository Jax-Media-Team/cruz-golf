import Link from "next/link";
import {
  fmtMoneyCents,
  fmtRelativeToPar,
  type ClubhouseBundle
} from "@/lib/clubhouse";

/**
 * The "living clubhouse" surface on the dashboard. Group-centric activity:
 * who's playing right now, who's been on a roll, what your group has been
 * doing this month.
 *
 * Tone (per Patrick, 2026-05-10): club-like, premium, believable, subtle,
 * socially authentic. Member-member, gambling-group, private-club,
 * weekend-trip, golf-trip group chat. NOT cartoonish, meme-heavy,
 * engagement-bait, or over-gamified. Statements, not exclamations. No
 * "SUPER HOT STREAK!!!" energy.
 *
 * Every signal is derived from data the user's group already owns — no
 * cross-group leakage, no global activity, no algorithmic discovery.
 *
 * Renders nothing if there's nothing meaningful to show. Never a
 * half-empty card just for the sake of being there.
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

      {/* Live rounds — quiet "live" dot, no fire emoji. The data is the
          interest, not the chrome. */}
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
              : `Just teed off`;
            return (
              <Link
                key={lr.round_id}
                href={url}
                prefetch={false}
                className="card card-hover p-4 flex items-center justify-between gap-3 border border-emerald-400/25 hover:bg-brand-900/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-serif text-base text-cream-50 truncate">
                      {leaderText}
                    </div>
                    <div className="text-xs text-cream-100/55 truncate">
                      {lr.course_name} · {lr.active_players}/
                      {lr.total_players} scoring
                    </div>
                  </div>
                </div>
                <span className="text-xs text-cream-100/55 shrink-0 hidden sm:inline">
                  Watch →
                </span>
              </Link>
            );
          })}
        </ul>
      )}

      {/* Streak + activity — understated stat lines, no fire/badges. */}
      {(hasStreak || hasActivity) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {hasStreak && bundle.streaks[0] && (
            <div className="card p-3 text-sm">
              <div className="text-cream-50 truncate">
                <span className="font-medium">
                  {bundle.streaks[0].display_name}
                </span>{" "}
                has won {bundle.streaks[0].consecutive_wins} rounds in a row
              </div>
              <div className="text-[11px] text-cream-100/55 mt-0.5">
                {fmtMoneyCents(bundle.streaks[0].total_cents)} taken across the
                streak
              </div>
            </div>
          )}

          {hasActivity && (
            <div className="card p-3 text-sm">
              <div className="text-cream-50 truncate">
                {bundle.group_name} ·{" "}
                {bundle.activity.rounds_recent} round
                {bundle.activity.rounds_recent === 1 ? "" : "s"} ·{" "}
                {fmtMoneyCents(bundle.activity.cents_moved_recent)} moved
              </div>
              <div className="text-[11px] text-cream-100/55 mt-0.5 truncate">
                Last {bundle.activity.window_days} days
                {bundle.activity.top_course
                  ? ` · most-played: ${bundle.activity.top_course.name}`
                  : ""}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
