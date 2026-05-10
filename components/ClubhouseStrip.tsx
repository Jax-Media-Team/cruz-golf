import Link from "next/link";
import {
  fmtGroupSpan,
  fmtMoneyCents,
  fmtRelativeToPar,
  type ClubhouseBundle,
  type PartnerSignal,
  type RivalrySignal
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

      {/* History stat cards — understated, member-member tone.
          Statements not exclamations. No badges, no fire emoji.
          Capped at 4 visible cards so the strip stays scannable. */}
      <HistoryCards bundle={bundle} />
    </section>
  );
}

/**
 * Builds and renders up to 4 stat cards from the bundle, prioritized by
 * what feels most alive right now:
 *   1. Active player streak (someone won N rounds in a row)
 *   2. Active rivalry run (one player taking money off another N straight)
 *   3. Top partner record (most-paired duo, win-rate forward)
 *   4. 30-day activity rollup
 *   5. Lifetime "your group has been at this for X" line
 */
function HistoryCards({ bundle }: { bundle: ClubhouseBundle }) {
  const cards: React.ReactNode[] = [];

  // Streak: one player on a roll.
  const streak = bundle.streaks[0];
  if (streak) {
    cards.push(
      <StatCard
        key="streak"
        primary={
          <>
            <span className="font-medium">{streak.display_name}</span> has won{" "}
            {streak.consecutive_wins} rounds in a row
          </>
        }
        secondary={`${fmtMoneyCents(streak.total_cents)} taken across the streak`}
      />
    );
  }

  // Rivalry: head-to-head streak (someone taking money off the same player
  // round after round). Only surface when there's an active run of 3+ —
  // otherwise it's just W-L noise.
  const runRivalry = bundle.rivalries.find(
    (r) => Math.abs(r.recent_run) >= 3
  );
  if (runRivalry) {
    cards.push(
      <StatCard key="rivalry-run" {...rivalryRunCopy(runRivalry)} />
    );
  } else if (bundle.rivalries[0] && bundle.rivalries[0].rounds_together >= 5) {
    // No active streak, but show a long-running matchup if there is one.
    cards.push(
      <StatCard key="rivalry-vol" {...rivalryStandingCopy(bundle.rivalries[0])} />
    );
  }

  // Partner chemistry: most-paired duo with their record.
  const partner = bundle.partners[0];
  if (partner && cards.length < 4) {
    cards.push(<StatCard key="partner" {...partnerCopy(partner)} />);
  }

  // 30-day activity.
  const activeRecent =
    bundle.activity.rounds_recent > 0 ||
    bundle.activity.cents_moved_recent > 0;
  if (activeRecent && cards.length < 4) {
    cards.push(
      <StatCard
        key="activity"
        primary={
          <>
            {bundle.group_name} · {bundle.activity.rounds_recent} round
            {bundle.activity.rounds_recent === 1 ? "" : "s"} ·{" "}
            {fmtMoneyCents(bundle.activity.cents_moved_recent)} moved
          </>
        }
        secondary={
          <>
            Last {bundle.activity.window_days} days
            {bundle.activity.top_course
              ? ` · most-played: ${bundle.activity.top_course.name}`
              : ""}
          </>
        }
      />
    );
  }

  // Lifetime: only show when the group's history is meaningfully long
  // (60+ days OR 8+ rounds). Otherwise it reads as filler.
  const span = fmtGroupSpan(bundle.lifetime.days_active);
  const lifetimeMeaningful =
    span && (bundle.lifetime.days_active >= 60 || bundle.lifetime.total_rounds >= 8);
  if (lifetimeMeaningful && cards.length < 4) {
    cards.push(
      <StatCard
        key="lifetime"
        primary={
          <>
            {bundle.group_name} ·{" "}
            {bundle.lifetime.total_rounds.toLocaleString()} round
            {bundle.lifetime.total_rounds === 1 ? "" : "s"} ·{" "}
            {fmtMoneyCents(bundle.lifetime.total_cents_moved)} moved
          </>
        }
        secondary={`Together ${span}`}
      />
    );
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{cards}</div>
  );
}

function StatCard({
  primary,
  secondary
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="card p-3 text-sm">
      <div className="text-cream-50 leading-snug">{primary}</div>
      {secondary && (
        <div className="text-[11px] text-cream-100/55 mt-0.5 leading-snug">
          {secondary}
        </div>
      )}
    </div>
  );
}

// Rivalry copy helpers — kept here next to the card so the data → words
// mapping stays in one place. Tone bar: subtle, statement, no emoji.
function rivalryRunCopy(r: RivalrySignal): {
  primary: React.ReactNode;
  secondary: React.ReactNode;
} {
  const winner = r.recent_run > 0 ? r.player_a_name : r.player_b_name;
  const loser = r.recent_run > 0 ? r.player_b_name : r.player_a_name;
  const n = Math.abs(r.recent_run);
  const winnerWins = r.recent_run > 0 ? r.a_wins : r.b_wins;
  const loserWins = r.recent_run > 0 ? r.b_wins : r.a_wins;
  return {
    primary: (
      <>
        <span className="font-medium">{winner}</span> has taken money off{" "}
        <span className="font-medium">{loser}</span> {n} rounds in a row
      </>
    ),
    secondary: `${winnerWins}-${loserWins} all-time over ${r.rounds_together} rounds together`
  };
}

function rivalryStandingCopy(r: RivalrySignal): {
  primary: React.ReactNode;
  secondary: React.ReactNode;
} {
  const leader = r.a_wins >= r.b_wins ? r.player_a_name : r.player_b_name;
  const trailer = r.a_wins >= r.b_wins ? r.player_b_name : r.player_a_name;
  const lw = Math.max(r.a_wins, r.b_wins);
  const tw = Math.min(r.a_wins, r.b_wins);
  return {
    primary: (
      <>
        <span className="font-medium">{leader}</span> vs{" "}
        <span className="font-medium">{trailer}</span> · {lw}-{tw} all-time
      </>
    ),
    secondary: `${r.rounds_together} rounds together${
      r.pushes > 0 ? ` · ${r.pushes} push${r.pushes === 1 ? "" : "es"}` : ""
    }`
  };
}

function partnerCopy(p: PartnerSignal): {
  primary: React.ReactNode;
  secondary: React.ReactNode;
} {
  return {
    primary: (
      <>
        <span className="font-medium">{p.player_a_name}</span> +{" "}
        <span className="font-medium">{p.player_b_name}</span> · {p.wins}-
        {p.losses} as partners
      </>
    ),
    secondary: `${p.rounds} round${p.rounds === 1 ? "" : "s"} together${
      p.combined_cents !== 0
        ? ` · ${fmtMoneyCents(p.combined_cents)} combined`
        : ""
    }`
  };
}
