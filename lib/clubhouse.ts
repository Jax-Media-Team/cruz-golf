/**
 * Living-clubhouse signals — group-centric activity for the dashboard.
 *
 * Pure functions on raw round / player / score / settlement rows. No DB,
 * no React. The principle (per Patrick, 2026-05-10):
 *
 *   "private golf crew · member-member weekend · golf trip · regular
 *    foursome · gambling buddies · 'our group lives here'"
 *
 *   NOT "public golf influencer feed · random strangers · algorithmic
 *    social app"
 *
 * Every signal is scoped to the user's own group(s) and derived from
 * data the group already owns. No cross-group leakage, no global
 * activity, no algorithmic discovery.
 */

export type ClubhouseRound = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  status: "draft" | "live" | "finalized";
  course_name: string | null;
  course_id: string | null;
  spectator_token: string | null;
  /** Number of holes the round is scheduled for (9 or 18). */
  holes: number;
};

export type ClubhouseRoundPlayer = {
  round_player_id: string;
  round_id: string;
  player_id: string;
  display_name: string;
};

export type ClubhouseScore = {
  round_player_id: string;
  hole_number: number;
  par: number;
  gross: number | null;
};

export type ClubhouseSettlement = {
  round_id: string;
  round_date: string; // ISO yyyy-mm-dd
  from_round_player_id: string;
  to_round_player_id: string;
  amount_cents: number;
};

// ---- Output shape ----

export type LiveRoundSignal = {
  round_id: string;
  course_name: string;
  date: string;
  spectator_token: string | null;
  /** Top scorer right now (lowest gross-vs-par). null if no scores yet. */
  leader: {
    display_name: string;
    /** Number of holes scored so far. */
    thru: number;
    /** Negative = under par, positive = over par. */
    relative_to_par: number;
  } | null;
  /** How many players have at least one score recorded. */
  active_players: number;
  /** Total players in the round. */
  total_players: number;
};

export type StreakSignal = {
  player_id: string;
  display_name: string;
  /** Number of consecutive most-recent finalized rounds where they won money. */
  consecutive_wins: number;
  /** Total cents won across that streak. */
  total_cents: number;
};

export type GroupActivitySignal = {
  /** Rounds finalized in the last N days. */
  rounds_recent: number;
  /** Cents that changed hands across all settlements in those rounds. */
  cents_moved_recent: number;
  /** Most-played course over the recent window. */
  top_course: {
    course_id: string;
    name: string;
    rounds: number;
  } | null;
  /** The recent-window length used (days). Echoed back so the UI can label correctly. */
  window_days: number;
};

export type ClubhouseBundle = {
  group_name: string;
  live_rounds: LiveRoundSignal[];
  streaks: StreakSignal[];
  activity: GroupActivitySignal;
};

// ---- Builders ----

/**
 * Compute live-round signals: for every round currently `status === "live"`,
 * who's leading (relative to par, on the holes they've actually played) and
 * how many players are actively scoring.
 *
 * Tie-break: lowest gross-vs-par wins. If still tied, the player with more
 * holes thru (further along) ranks first — they've earned more of the score.
 */
export function buildLiveRoundSignals(
  rounds: ClubhouseRound[],
  rps: ClubhouseRoundPlayer[],
  scores: ClubhouseScore[]
): LiveRoundSignal[] {
  const liveRounds = rounds.filter((r) => r.status === "live");
  if (liveRounds.length === 0) return [];

  const rpsByRound = new Map<string, ClubhouseRoundPlayer[]>();
  for (const rp of rps) {
    const arr = rpsByRound.get(rp.round_id) ?? [];
    arr.push(rp);
    rpsByRound.set(rp.round_id, arr);
  }

  const scoresByRp = new Map<string, ClubhouseScore[]>();
  for (const s of scores) {
    const arr = scoresByRp.get(s.round_player_id) ?? [];
    arr.push(s);
    scoresByRp.set(s.round_player_id, arr);
  }

  const out: LiveRoundSignal[] = [];
  for (const round of liveRounds) {
    const roundRps = rpsByRound.get(round.id) ?? [];
    let active = 0;
    let leader: LiveRoundSignal["leader"] = null;
    for (const rp of roundRps) {
      const rpScores = (scoresByRp.get(rp.round_player_id) ?? []).filter(
        (s) => s.gross != null
      );
      if (rpScores.length === 0) continue;
      active += 1;
      const thru = rpScores.length;
      const relative = rpScores.reduce(
        (sum, s) => sum + ((s.gross as number) - s.par),
        0
      );
      if (
        leader == null ||
        relative < leader.relative_to_par ||
        (relative === leader.relative_to_par && thru > leader.thru)
      ) {
        leader = {
          display_name: rp.display_name,
          thru,
          relative_to_par: relative
        };
      }
    }
    out.push({
      round_id: round.id,
      course_name: round.course_name ?? "Course",
      date: round.date,
      spectator_token: round.spectator_token,
      leader,
      active_players: active,
      total_players: roundRps.length
    });
  }
  // Most recently dated first.
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

/**
 * "Has won the last N rounds in a row." Walks each player's finalized
 * rounds in reverse-chronological order and counts how many they
 * netted positive on. Stops at the first non-positive round (zero or
 * loss). Returns players with `consecutive_wins >= minStreak`, sorted
 * by streak length (then by total cents won, then by name).
 *
 * "Won money" = sum(settlements where rp is `to`) - sum(`from`) > 0.
 */
export function buildStreakSignals(
  rps: ClubhouseRoundPlayer[],
  settlements: ClubhouseSettlement[],
  rounds: ClubhouseRound[],
  opts: { minStreak?: number } = {}
): StreakSignal[] {
  const minStreak = opts.minStreak ?? 2;
  const finalizedDates = new Map<string, string>();
  for (const r of rounds) {
    if (r.status === "finalized") finalizedDates.set(r.id, r.date);
  }

  // Per-rp net cents in their round.
  const netByRp = new Map<string, number>();
  for (const s of settlements) {
    if (!finalizedDates.has(s.round_id)) continue;
    netByRp.set(
      s.from_round_player_id,
      (netByRp.get(s.from_round_player_id) ?? 0) - s.amount_cents
    );
    netByRp.set(
      s.to_round_player_id,
      (netByRp.get(s.to_round_player_id) ?? 0) + s.amount_cents
    );
  }

  // Per-player: list of {date, net} sorted desc by date. Need rp -> player.
  type PlayerRound = { date: string; net: number; round_id: string };
  const perPlayer = new Map<
    string,
    { display_name: string; rounds: PlayerRound[] }
  >();
  for (const rp of rps) {
    const date = finalizedDates.get(rp.round_id);
    if (!date) continue;
    const net = netByRp.get(rp.round_player_id) ?? 0;
    const entry = perPlayer.get(rp.player_id) ?? {
      display_name: rp.display_name,
      rounds: []
    };
    entry.rounds.push({ date, net, round_id: rp.round_id });
    perPlayer.set(rp.player_id, entry);
  }

  const out: StreakSignal[] = [];
  for (const [player_id, e] of perPlayer.entries()) {
    e.rounds.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    let streak = 0;
    let total = 0;
    for (const r of e.rounds) {
      if (r.net > 0) {
        streak += 1;
        total += r.net;
      } else {
        break;
      }
    }
    if (streak >= minStreak) {
      out.push({
        player_id,
        display_name: e.display_name,
        consecutive_wins: streak,
        total_cents: total
      });
    }
  }
  out.sort((a, b) => {
    if (b.consecutive_wins !== a.consecutive_wins)
      return b.consecutive_wins - a.consecutive_wins;
    if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents;
    return a.display_name.localeCompare(b.display_name);
  });
  return out;
}

/**
 * Group activity over the last N days: how many rounds finalized,
 * how much money moved, and the most-played course. Keeps the metric
 * private-group-scoped (caller passes only their group's rows).
 *
 * `today` is injected for testability.
 */
export function buildGroupActivitySignal(
  rounds: ClubhouseRound[],
  settlements: ClubhouseSettlement[],
  opts: { windowDays?: number; today?: string } = {}
): GroupActivitySignal {
  const windowDays = opts.windowDays ?? 30;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = isoMinusDays(today, windowDays);

  const recentFinalized = rounds.filter(
    (r) => r.status === "finalized" && r.date >= cutoff && r.date <= today
  );
  const recentRoundIds = new Set(recentFinalized.map((r) => r.id));

  let cents = 0;
  for (const s of settlements) {
    if (recentRoundIds.has(s.round_id)) cents += s.amount_cents;
  }

  // Most played course in window.
  const courseCounts = new Map<string, { name: string; rounds: number }>();
  for (const r of recentFinalized) {
    if (!r.course_id) continue;
    const e = courseCounts.get(r.course_id) ?? {
      name: r.course_name ?? "Course",
      rounds: 0
    };
    e.rounds += 1;
    courseCounts.set(r.course_id, e);
  }
  let top: GroupActivitySignal["top_course"] = null;
  for (const [course_id, e] of courseCounts.entries()) {
    if (!top || e.rounds > top.rounds) {
      top = { course_id, name: e.name, rounds: e.rounds };
    }
  }

  return {
    rounds_recent: recentFinalized.length,
    cents_moved_recent: cents,
    top_course: top,
    window_days: windowDays
  };
}

// ---- Convenience: combined builder ----

export function buildClubhouse(input: {
  group_name: string;
  rounds: ClubhouseRound[];
  rps: ClubhouseRoundPlayer[];
  scores: ClubhouseScore[];
  settlements: ClubhouseSettlement[];
  windowDays?: number;
  today?: string;
  minStreak?: number;
}): ClubhouseBundle {
  return {
    group_name: input.group_name,
    live_rounds: buildLiveRoundSignals(input.rounds, input.rps, input.scores),
    streaks: buildStreakSignals(input.rps, input.settlements, input.rounds, {
      minStreak: input.minStreak
    }),
    activity: buildGroupActivitySignal(input.rounds, input.settlements, {
      windowDays: input.windowDays,
      today: input.today
    })
  };
}

// ---- helpers ----

function isoMinusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  t.setUTCDate(t.getUTCDate() - days);
  return t.toISOString().slice(0, 10);
}

export function fmtRelativeToPar(n: number): string {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`; // negative number already has its sign
}

export function fmtMoneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
