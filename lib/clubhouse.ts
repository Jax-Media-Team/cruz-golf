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
  status: "draft" | "live" | "pending_finalization" | "finalized";
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
  /** Optional team_id from round_players. Two rps with the same non-null
   *  team_id in a round are partners for that round. Used by partner-
   *  chemistry signals; safe to omit on rps that aren't team-game-bound. */
  team_id?: string | null;
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

export type RivalrySignal = {
  /** Stable id pair, alphabetized so the same matchup is one row. */
  player_a_id: string;
  player_a_name: string;
  player_b_id: string;
  player_b_name: string;
  /** Wins for A over B (A netted strictly more in those rounds). */
  a_wins: number;
  b_wins: number;
  /** Pushes/ties (equal net, including both-zero). */
  pushes: number;
  /** Most-recent consecutive run of one side beating the other. Negative
   *  when B is the runner; magnitude is run length. 0 when last round
   *  was a push. */
  recent_run: number;
  /** Total rounds where both players played. */
  rounds_together: number;
};

export type PartnerSignal = {
  player_a_id: string;
  player_a_name: string;
  player_b_id: string;
  player_b_name: string;
  /** Rounds where they shared a team_id. */
  rounds: number;
  /** Rounds the team netted positive money (combined). */
  wins: number;
  /** Rounds the team netted negative money. */
  losses: number;
  /** Rounds the team netted zero. */
  pushes: number;
  /** Combined cents won across all paired rounds (sum of both rps). */
  combined_cents: number;
};

export type CareerMoneyEntry = {
  player_id: string;
  display_name: string;
  /** Lifetime cents netted (positive = won money; negative = lost). */
  net_cents: number;
  /** How many finalized rounds this player has played. */
  rounds: number;
};

export type LastRoundSignal = {
  round_id: string;
  date: string;
  course_name: string | null;
  /** Top finisher (lowest gross or net depending on what the round
   *  scored on; we just use lowest gross-over-par here for simplicity). */
  leader: {
    player_id: string;
    display_name: string;
    relative_to_par: number;
    gross: number;
  } | null;
  /** Biggest cents winner (sum of settlement edges to this player). */
  biggest_winner: {
    player_id: string;
    display_name: string;
    net_cents: number;
  } | null;
  /** Biggest cents loser. */
  biggest_loser: {
    player_id: string;
    display_name: string;
    net_cents: number;
  } | null;
  /** Total cents that moved in this round (sum of all settlement edges). */
  total_cents_moved: number;
  /** Number of distinct settlement edges. */
  edges: number;
};

export type GroupLifetimeSignal = {
  /** All finalized rounds the group has played, ever. */
  total_rounds: number;
  /** Cumulative cents that has changed hands across every settlement. */
  total_cents_moved: number;
  /** ISO date of the earliest finalized round in the group's history. */
  first_round_date: string | null;
  /** Days between first finalized round and today (or 0 if no history). */
  days_active: number;
};

export type CourseMasterySignal = {
  course_id: string;
  course_name: string;
  /** Player with the lowest 18-hole-equivalent average gross at this
   *  course among players who have ≥minRounds finalized rounds there. */
  leader: {
    player_id: string;
    display_name: string;
    /** Average gross normalized to 18 holes (so 9-hole rounds are
     *  scaled up). */
    avg_gross_18: number;
    /** Lowest single-round gross at the course. */
    best_gross: number;
    /** How many finalized rounds the player has at this course. */
    rounds_at_course: number;
  };
  /** Optional second place — included so the UI can render
   *  "Patrick averages 78.4 over 6 rounds at JGCC; Mitch is next at
   *  79.2." */
  runner_up?: {
    player_id: string;
    display_name: string;
    avg_gross_18: number;
    rounds_at_course: number;
  };
};

export type HoleMasterySignal = {
  course_id: string;
  course_name: string;
  hole_number: number;
  par: number;
  leader: {
    player_id: string;
    display_name: string;
    /** Average gross on this hole. Lower = better. */
    avg_score: number;
    /** Avg score minus par. Negative = under par on average. */
    vs_par: number;
    /** How many times the player has scored this hole. */
    hole_count: number;
  };
};

export type BiggestPotSignal = {
  /** Round where the largest cents-moved event occurred. */
  round_id: string;
  date: string;
  course_name: string | null;
  /** Total absolute cents that changed hands in this round across all
   *  settlements (sum of all settlement edges). */
  total_cents_moved: number;
  /** How many distinct settlement edges this round had. */
  edges: number;
};

export type MilestoneSignal = {
  player_id: string;
  display_name: string;
  /** Short, distinct-per-event kind. The same player can have multiple
   *  milestones across different kinds, but only ONE per (player, kind)
   *  ever — these are first-time events. */
  kind:
    | "broke_80"
    | "broke_90"
    | "broke_100"
    | "personal_best"
    | "first_eagle";
  date: string;
  round_id: string;
  course_name: string | null;
  /** Numeric value tied to the milestone (the gross score for breaks,
   *  the new best for PR, hole number for eagle). UI decides whether
   *  and how to render it. */
  value: number;
  /** Optional secondary context for milestone UI ("first time across N
   *  rounds at this course," etc.). */
  context?: string;
};

export type ClubhouseBundle = {
  group_name: string;
  live_rounds: LiveRoundSignal[];
  streaks: StreakSignal[];
  activity: GroupActivitySignal;
  rivalries: RivalrySignal[];
  partners: PartnerSignal[];
  lifetime: GroupLifetimeSignal;
  course_mastery: CourseMasterySignal[];
  /** Per-(course, hole) leaders. Surfaced in restrained sub-cards
   *  ("Mitch owns hole 4 at JGCC: 3.4 avg, 3 plays"). */
  hole_mastery: HoleMasterySignal[];
  /** Career money leaderboard — lifetime cents netted by every player
   *  who's played a finalized round. Sorted by net_cents desc. */
  career_money: CareerMoneyEntry[];
  /** Most recent finalized round in the group, with leader + biggest
   *  winner/loser. Null when no finalized rounds exist. */
  last_round: LastRoundSignal | null;
  /** Single biggest-pot round in the group's history. Surfaced when
   *  meaningfully large (≥ $50 moved). Null when there's nothing
   *  noteworthy. */
  biggest_pot: BiggestPotSignal | null;
  /** Milestones from finalized rounds in the last `windowDays` only —
   *  surfacing yesterday's first sub-80 round is meaningful; surfacing
   *  one from 9 months ago is filler. */
  recent_milestones: MilestoneSignal[];
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

/**
 * Head-to-head rivalry signals. For every pair of players who have played
 * `minRounds` finalized rounds together, computes the W-L-P record where
 * "A wins a round" = A netted strictly more cents than B in that round.
 *
 * Tone discipline: the output is just numbers (W-L over N rounds, plus a
 * recent-run streak when one side is on a tear). It's the consumer's job
 * to keep the rendered copy understated — "Luis 4-1 vs Patrick over the
 * last 5", not "🔥 LUIS DOMINATES PATRICK".
 */
export function buildRivalrySignals(
  rps: ClubhouseRoundPlayer[],
  settlements: ClubhouseSettlement[],
  rounds: ClubhouseRound[],
  opts: { minRounds?: number } = {}
): RivalrySignal[] {
  const minRounds = opts.minRounds ?? 3;
  const finalizedRoundsByDate = new Map<string, string>();
  for (const r of rounds) {
    if (r.status === "finalized") finalizedRoundsByDate.set(r.id, r.date);
  }

  // Each rp's net cents in its own round.
  const netByRp = new Map<string, number>();
  for (const s of settlements) {
    if (!finalizedRoundsByDate.has(s.round_id)) continue;
    netByRp.set(
      s.from_round_player_id,
      (netByRp.get(s.from_round_player_id) ?? 0) - s.amount_cents
    );
    netByRp.set(
      s.to_round_player_id,
      (netByRp.get(s.to_round_player_id) ?? 0) + s.amount_cents
    );
  }

  // Group rps by round so we can compare players who actually played
  // together in the same round.
  type PlayerRow = {
    player_id: string;
    display_name: string;
    net: number;
  };
  const byRound = new Map<string, PlayerRow[]>();
  for (const rp of rps) {
    const date = finalizedRoundsByDate.get(rp.round_id);
    if (!date) continue;
    const arr = byRound.get(rp.round_id) ?? [];
    arr.push({
      player_id: rp.player_id,
      display_name: rp.display_name,
      net: netByRp.get(rp.round_player_id) ?? 0
    });
    byRound.set(rp.round_id, arr);
  }

  // Aggregate per pair.
  type Pair = {
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
    a_wins: number;
    b_wins: number;
    pushes: number;
    rounds: number;
    /** Per-round outcome from A's perspective, ordered by round date asc.
     *  +1 = A won, -1 = B won, 0 = push. Used to compute recent_run. */
    history: { date: string; outcome: 1 | -1 | 0 }[];
  };
  const pairs = new Map<string, Pair>();
  const sortedRoundIds = [...byRound.keys()].sort((a, b) => {
    const da = finalizedRoundsByDate.get(a) ?? "";
    const db = finalizedRoundsByDate.get(b) ?? "";
    return da < db ? -1 : da > db ? 1 : 0;
  });
  for (const round_id of sortedRoundIds) {
    const playersInRound = byRound.get(round_id) ?? [];
    const date = finalizedRoundsByDate.get(round_id) ?? "";
    for (let i = 0; i < playersInRound.length; i++) {
      for (let j = i + 1; j < playersInRound.length; j++) {
        const x = playersInRound[i];
        const y = playersInRound[j];
        // Alphabetize id so the same matchup is always one row.
        const [a, b] = x.player_id < y.player_id ? [x, y] : [y, x];
        const key = `${a.player_id}|${b.player_id}`;
        const entry = pairs.get(key) ?? {
          a_id: a.player_id,
          a_name: a.display_name,
          b_id: b.player_id,
          b_name: b.display_name,
          a_wins: 0,
          b_wins: 0,
          pushes: 0,
          rounds: 0,
          history: []
        };
        entry.rounds += 1;
        let outcome: 1 | -1 | 0;
        if (a.net > b.net) {
          entry.a_wins += 1;
          outcome = 1;
        } else if (b.net > a.net) {
          entry.b_wins += 1;
          outcome = -1;
        } else {
          entry.pushes += 1;
          outcome = 0;
        }
        entry.history.push({ date, outcome });
        pairs.set(key, entry);
      }
    }
  }

  const out: RivalrySignal[] = [];
  for (const p of pairs.values()) {
    if (p.rounds < minRounds) continue;
    // Compute the most-recent consecutive same-direction run.
    let recent_run = 0;
    for (let i = p.history.length - 1; i >= 0; i--) {
      const o = p.history[i].outcome;
      if (o === 0) break; // Push breaks the run.
      if (recent_run === 0) {
        recent_run = o; // First non-push from the end seeds direction.
      } else if (Math.sign(recent_run) === o) {
        recent_run += o;
      } else {
        break; // Direction flipped.
      }
    }
    out.push({
      player_a_id: p.a_id,
      player_a_name: p.a_name,
      player_b_id: p.b_id,
      player_b_name: p.b_name,
      a_wins: p.a_wins,
      b_wins: p.b_wins,
      pushes: p.pushes,
      recent_run,
      rounds_together: p.rounds
    });
  }
  // Sort: longest current-run first (one-sided streaks are the
  // emotionally interesting signal), then by lopsidedness, then volume.
  out.sort((a, b) => {
    const aRun = Math.abs(a.recent_run);
    const bRun = Math.abs(b.recent_run);
    if (aRun !== bRun) return bRun - aRun;
    const aLopside = Math.abs(a.a_wins - a.b_wins);
    const bLopside = Math.abs(b.a_wins - b.b_wins);
    if (aLopside !== bLopside) return bLopside - aLopside;
    return b.rounds_together - a.rounds_together;
  });
  return out;
}

/**
 * Partner-chemistry signals. Two rps with the same non-null team_id in a
 * round are partners for that round; their team's net is the sum of their
 * individual nets (settlements are stored per rp). Aggregates W-L-P
 * across every round they were paired.
 *
 * Filters to pairs with `minRounds`+ paired rounds so a one-time team-up
 * doesn't dominate the signal.
 */
export function buildPartnerSignals(
  rps: ClubhouseRoundPlayer[],
  settlements: ClubhouseSettlement[],
  rounds: ClubhouseRound[],
  opts: { minRounds?: number } = {}
): PartnerSignal[] {
  const minRounds = opts.minRounds ?? 2;
  const finalizedRoundIds = new Set(
    rounds.filter((r) => r.status === "finalized").map((r) => r.id)
  );

  const netByRp = new Map<string, number>();
  for (const s of settlements) {
    if (!finalizedRoundIds.has(s.round_id)) continue;
    netByRp.set(
      s.from_round_player_id,
      (netByRp.get(s.from_round_player_id) ?? 0) - s.amount_cents
    );
    netByRp.set(
      s.to_round_player_id,
      (netByRp.get(s.to_round_player_id) ?? 0) + s.amount_cents
    );
  }

  // Bucket rps by (round_id, team_id), skipping null team_id.
  type TeamMember = {
    rp_id: string;
    player_id: string;
    display_name: string;
  };
  const teams = new Map<string, TeamMember[]>();
  for (const rp of rps) {
    if (!finalizedRoundIds.has(rp.round_id)) continue;
    if (!rp.team_id) continue;
    const key = `${rp.round_id}|${rp.team_id}`;
    const arr = teams.get(key) ?? [];
    arr.push({
      rp_id: rp.round_player_id,
      player_id: rp.player_id,
      display_name: rp.display_name
    });
    teams.set(key, arr);
  }

  type Pair = {
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
    rounds: number;
    wins: number;
    losses: number;
    pushes: number;
    combined_cents: number;
  };
  const pairs = new Map<string, Pair>();
  for (const team of teams.values()) {
    if (team.length < 2) continue;
    const teamNet = team.reduce((s, m) => s + (netByRp.get(m.rp_id) ?? 0), 0);
    // Every unordered pair within the team — supports 3+ player teams too.
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const x = team[i];
        const y = team[j];
        const [a, b] = x.player_id < y.player_id ? [x, y] : [y, x];
        const key = `${a.player_id}|${b.player_id}`;
        const entry = pairs.get(key) ?? {
          a_id: a.player_id,
          a_name: a.display_name,
          b_id: b.player_id,
          b_name: b.display_name,
          rounds: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          combined_cents: 0
        };
        entry.rounds += 1;
        if (teamNet > 0) entry.wins += 1;
        else if (teamNet < 0) entry.losses += 1;
        else entry.pushes += 1;
        entry.combined_cents += teamNet;
        pairs.set(key, entry);
      }
    }
  }

  const out: PartnerSignal[] = [];
  for (const p of pairs.values()) {
    if (p.rounds < minRounds) continue;
    out.push({
      player_a_id: p.a_id,
      player_a_name: p.a_name,
      player_b_id: p.b_id,
      player_b_name: p.b_name,
      rounds: p.rounds,
      wins: p.wins,
      losses: p.losses,
      pushes: p.pushes,
      combined_cents: p.combined_cents
    });
  }
  // Sort: most paired rounds first (history depth wins). Tie-break by
  // win-rate (winners surface), then by combined cents.
  out.sort((a, b) => {
    if (b.rounds !== a.rounds) return b.rounds - a.rounds;
    const aRate = a.rounds > 0 ? a.wins / a.rounds : 0;
    const bRate = b.rounds > 0 ? b.wins / b.rounds : 0;
    if (bRate !== aRate) return bRate - aRate;
    return b.combined_cents - a.combined_cents;
  });
  return out;
}

/**
 * Group lifetime totals — rounds played, cents moved, days the group has
 * been active. The "our group has been at this for X years" signal that
 * makes a long-running foursome's history feel real.
 *
 * Inputs should include the FULL group history, not a windowed slice, so
 * the totals are accurate. (The activity signal handles the rolling
 * window separately.)
 */
export function buildGroupLifetimeSignal(
  rounds: ClubhouseRound[],
  settlements: ClubhouseSettlement[],
  opts: { today?: string } = {}
): GroupLifetimeSignal {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const finalized = rounds.filter((r) => r.status === "finalized");
  if (finalized.length === 0) {
    return {
      total_rounds: 0,
      total_cents_moved: 0,
      first_round_date: null,
      days_active: 0
    };
  }
  const finalizedIds = new Set(finalized.map((r) => r.id));
  let cents = 0;
  for (const s of settlements) {
    if (finalizedIds.has(s.round_id)) cents += s.amount_cents;
  }
  let earliest = finalized[0].date;
  for (const r of finalized) {
    if (r.date < earliest) earliest = r.date;
  }
  return {
    total_rounds: finalized.length,
    total_cents_moved: cents,
    first_round_date: earliest,
    days_active: daysBetween(earliest, today)
  };
}

/**
 * Course-mastery signals. For every course the group has finalized rounds
 * at, picks the player with the lowest 18-hole-equivalent average gross
 * who has played `minRounds` (default 3) finalized rounds at that course.
 *
 * Tone discipline: returns numeric data only. UI decides whether to phrase
 * as "Patrick averages 78.4 at JGCC over 6 rounds" or "Patrick: 78.4 / 6".
 * No "owns the course" language baked into the engine — the UI gets to
 * decide what's understated for its surface.
 *
 * Returns sorted by depth (player's rounds_at_course desc) so deep
 * histories rank above one-time leaders.
 */
export function buildCourseMasterySignals(
  rounds: ClubhouseRound[],
  rps: ClubhouseRoundPlayer[],
  scores: ClubhouseScore[],
  opts: { minRounds?: number } = {}
): CourseMasterySignal[] {
  const minRounds = opts.minRounds ?? 3;

  // round_id -> { date, course_id, course_name, holes_scheduled }
  const finalizedRounds = new Map<
    string,
    { course_id: string; course_name: string; holes_scheduled: number }
  >();
  for (const r of rounds) {
    if (r.status !== "finalized") continue;
    if (!r.course_id) continue;
    finalizedRounds.set(r.id, {
      course_id: r.course_id,
      course_name: r.course_name ?? "Course",
      holes_scheduled: r.holes ?? 18
    });
  }

  // round_player_id -> sum of gross over scored holes + count of scored holes.
  const grossByRp = new Map<string, { sum: number; count: number }>();
  for (const s of scores) {
    if (s.gross == null) continue;
    const e = grossByRp.get(s.round_player_id) ?? { sum: 0, count: 0 };
    e.sum += s.gross;
    e.count += 1;
    grossByRp.set(s.round_player_id, e);
  }

  // (course_id, player_id) -> aggregated stats
  type Agg = {
    course_id: string;
    course_name: string;
    player_id: string;
    display_name: string;
    /** Sum of 18-hole-equivalent gross totals across rounds. */
    sum_gross_18: number;
    rounds_count: number;
    best_gross: number;
  };
  const agg = new Map<string, Agg>();

  for (const rp of rps) {
    const round = finalizedRounds.get(rp.round_id);
    if (!round) continue;
    const totals = grossByRp.get(rp.round_player_id);
    if (!totals || totals.count === 0) continue;
    // Only count rounds where at least 9 holes were actually scored —
    // partial 4-hole abandons would otherwise distort the average.
    if (totals.count < 9) continue;

    // Normalize to 18 holes so a 9-hole round at the same course doesn't
    // make a player look better than they are. We use SCORED holes as the
    // denominator, not the round's `holes` field, because some rounds end
    // early and we still want to compare apples to apples.
    const gross_18 = (totals.sum * 18) / totals.count;
    const key = `${round.course_id}|${rp.player_id}`;
    const existing = agg.get(key) ?? {
      course_id: round.course_id,
      course_name: round.course_name,
      player_id: rp.player_id,
      display_name: rp.display_name,
      sum_gross_18: 0,
      rounds_count: 0,
      best_gross: Number.POSITIVE_INFINITY
    };
    existing.sum_gross_18 += gross_18;
    existing.rounds_count += 1;
    if (totals.sum < existing.best_gross) existing.best_gross = totals.sum;
    agg.set(key, existing);
  }

  // Group by course; pick the leader (lowest avg) with ≥minRounds.
  type CourseRecords = {
    course_id: string;
    course_name: string;
    rows: Array<Agg & { avg_gross_18: number }>;
  };
  const byCourse = new Map<string, CourseRecords>();
  for (const e of agg.values()) {
    if (e.rounds_count < minRounds) continue;
    const avg = e.sum_gross_18 / e.rounds_count;
    const cr = byCourse.get(e.course_id) ?? {
      course_id: e.course_id,
      course_name: e.course_name,
      rows: []
    };
    cr.rows.push({ ...e, avg_gross_18: avg });
    byCourse.set(e.course_id, cr);
  }

  const out: CourseMasterySignal[] = [];
  for (const cr of byCourse.values()) {
    cr.rows.sort((a, b) => a.avg_gross_18 - b.avg_gross_18);
    const leader = cr.rows[0];
    if (!leader) continue;
    const runnerUp = cr.rows[1];
    out.push({
      course_id: cr.course_id,
      course_name: cr.course_name,
      leader: {
        player_id: leader.player_id,
        display_name: leader.display_name,
        avg_gross_18: round1(leader.avg_gross_18),
        best_gross: leader.best_gross,
        rounds_at_course: leader.rounds_count
      },
      runner_up: runnerUp
        ? {
            player_id: runnerUp.player_id,
            display_name: runnerUp.display_name,
            avg_gross_18: round1(runnerUp.avg_gross_18),
            rounds_at_course: runnerUp.rounds_count
          }
        : undefined
    });
  }
  // Deepest-history courses first.
  out.sort((a, b) => b.leader.rounds_at_course - a.leader.rounds_at_course);
  return out;
}

/**
 * Recent first-time milestones. Walks each player's finalized rounds in
 * chronological order and detects the FIRST occurrence of:
 *
 *   - broke 80 (gross < 80 on a fully-scored 18-hole round)
 *   - broke 90 (same, but only when they hadn't already broken 80)
 *   - broke 100 (same, but only when they hadn't already broken 90)
 *   - new personal best (gross strictly lower than every prior 18-hole round)
 *   - first eagle (a single hole scored ≥2 under par)
 *
 * Returns ONLY milestones whose round_date is within the last
 * `windowDays` (default 14). Older milestones are still detected but
 * filtered out — surfacing yesterday's sub-80 is meaningful; surfacing
 * one from last spring isn't.
 *
 * Idempotent: each player gets at most one of each kind, and the trigger
 * is deterministic from the data. Re-rendering the dashboard doesn't
 * re-fire milestones, and adding a NEW round can't retroactively flip
 * an old milestone (the chronological walk respects round date order).
 */
export function buildRecentMilestones(
  rounds: ClubhouseRound[],
  rps: ClubhouseRoundPlayer[],
  scores: ClubhouseScore[],
  opts: { windowDays?: number; today?: string } = {}
): MilestoneSignal[] {
  const windowDays = opts.windowDays ?? 14;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = isoMinusDays(today, windowDays);

  // round_id -> finalized round metadata
  const finalized = new Map<
    string,
    { date: string; course_name: string | null; holes_scheduled: number }
  >();
  for (const r of rounds) {
    if (r.status !== "finalized") continue;
    finalized.set(r.id, {
      date: r.date,
      course_name: r.course_name,
      holes_scheduled: r.holes ?? 18
    });
  }

  // round_player_id -> { gross_total, holes_scored, has_eagle, eagle_hole }
  const rpStats = new Map<
    string,
    {
      gross_total: number;
      holes_scored: number;
      eagle_hole: number | null;
    }
  >();
  for (const s of scores) {
    if (s.gross == null) continue;
    const e = rpStats.get(s.round_player_id) ?? {
      gross_total: 0,
      holes_scored: 0,
      eagle_hole: null
    };
    e.gross_total += s.gross;
    e.holes_scored += 1;
    if (e.eagle_hole == null && s.gross <= s.par - 2) {
      e.eagle_hole = s.hole_number;
    }
    rpStats.set(s.round_player_id, e);
  }

  // Player -> chronological list of (date, round_id, gross_total,
  // holes_scored, holes_scheduled, course_name, eagle_hole)
  type RoundEntry = {
    date: string;
    round_id: string;
    gross_total: number;
    holes_scored: number;
    holes_scheduled: number;
    course_name: string | null;
    eagle_hole: number | null;
  };
  const byPlayer = new Map<
    string,
    { display_name: string; rounds: RoundEntry[] }
  >();
  for (const rp of rps) {
    const round = finalized.get(rp.round_id);
    if (!round) continue;
    const stats = rpStats.get(rp.round_player_id);
    if (!stats || stats.holes_scored === 0) continue;
    const entry = byPlayer.get(rp.player_id) ?? {
      display_name: rp.display_name,
      rounds: []
    };
    entry.rounds.push({
      date: round.date,
      round_id: rp.round_id,
      gross_total: stats.gross_total,
      holes_scored: stats.holes_scored,
      holes_scheduled: round.holes_scheduled,
      course_name: round.course_name,
      eagle_hole: stats.eagle_hole
    });
    byPlayer.set(rp.player_id, entry);
  }

  const out: MilestoneSignal[] = [];
  for (const [player_id, e] of byPlayer.entries()) {
    e.rounds.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    // Gross-break milestones — only count fully-scored 18-hole rounds
    // (so a 9-hole 38 doesn't count as breaking 80).
    let broke80 = false;
    let broke90 = false;
    let broke100 = false;
    let firstEagle = false;
    let bestSoFar: number | null = null;

    for (const r of e.rounds) {
      const fully18 = r.holes_scheduled === 18 && r.holes_scored === 18;

      // Personal best — only on fully-scored 18s.
      if (fully18) {
        if (bestSoFar == null) {
          // First 18-hole round establishes the baseline; not a
          // milestone by itself.
          bestSoFar = r.gross_total;
        } else if (r.gross_total < bestSoFar) {
          // New personal best — surface only if recent.
          if (r.date >= cutoff) {
            out.push({
              player_id,
              display_name: e.display_name,
              kind: "personal_best",
              date: r.date,
              round_id: r.round_id,
              course_name: r.course_name,
              value: r.gross_total,
              context: `previous best ${bestSoFar}`
            });
          }
          bestSoFar = r.gross_total;
        }
      }

      if (fully18 && !broke80 && r.gross_total < 80) {
        broke80 = true;
        if (r.date >= cutoff) {
          out.push({
            player_id,
            display_name: e.display_name,
            kind: "broke_80",
            date: r.date,
            round_id: r.round_id,
            course_name: r.course_name,
            value: r.gross_total
          });
        }
      } else if (
        fully18 &&
        !broke80 &&
        !broke90 &&
        r.gross_total < 90
      ) {
        broke90 = true;
        if (r.date >= cutoff) {
          out.push({
            player_id,
            display_name: e.display_name,
            kind: "broke_90",
            date: r.date,
            round_id: r.round_id,
            course_name: r.course_name,
            value: r.gross_total
          });
        }
      } else if (
        fully18 &&
        !broke80 &&
        !broke90 &&
        !broke100 &&
        r.gross_total < 100
      ) {
        broke100 = true;
        if (r.date >= cutoff) {
          out.push({
            player_id,
            display_name: e.display_name,
            kind: "broke_100",
            date: r.date,
            round_id: r.round_id,
            course_name: r.course_name,
            value: r.gross_total
          });
        }
      }

      if (!firstEagle && r.eagle_hole != null) {
        firstEagle = true;
        if (r.date >= cutoff) {
          out.push({
            player_id,
            display_name: e.display_name,
            kind: "first_eagle",
            date: r.date,
            round_id: r.round_id,
            course_name: r.course_name,
            value: r.eagle_hole
          });
        }
      }
    }
  }

  // Most recent milestone first; tie-break by name for stable ordering.
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.display_name.localeCompare(b.display_name);
  });
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Hole mastery — for every (course, hole) the group has played at least
 * `minPlays` finalized times, picks the player with the lowest average
 * score on that hole. Sorted hardest-hole-first (highest avg-vs-par
 * across all leaders).
 *
 * Tone: just data ("Mitch · 3.4 avg · 5 plays at JGCC hole 4"). No
 * "owns the hole" language — UI decides phrasing.
 */
export function buildHoleMasterySignals(
  rounds: ClubhouseRound[],
  rps: ClubhouseRoundPlayer[],
  scores: ClubhouseScore[],
  opts: { minPlays?: number } = {}
): HoleMasterySignal[] {
  const minPlays = opts.minPlays ?? 3;
  const finalizedRounds = new Map<
    string,
    { course_id: string; course_name: string }
  >();
  for (const r of rounds) {
    if (r.status !== "finalized") continue;
    if (!r.course_id) continue;
    finalizedRounds.set(r.id, {
      course_id: r.course_id,
      course_name: r.course_name ?? "Course"
    });
  }

  // rp_id -> { round_id, player_id, display_name }
  const rpMeta = new Map<
    string,
    { round_id: string; player_id: string; display_name: string }
  >();
  for (const rp of rps) {
    rpMeta.set(rp.round_player_id, {
      round_id: rp.round_id,
      player_id: rp.player_id,
      display_name: rp.display_name
    });
  }

  // (course_id, hole_number, player_id) -> { sum_gross, plays, par, name, course_name }
  type Agg = {
    course_id: string;
    course_name: string;
    hole_number: number;
    par: number;
    player_id: string;
    display_name: string;
    sum_gross: number;
    plays: number;
  };
  const agg = new Map<string, Agg>();
  for (const s of scores) {
    if (s.gross == null) continue;
    const meta = rpMeta.get(s.round_player_id);
    if (!meta) continue;
    const round = finalizedRounds.get(meta.round_id);
    if (!round) continue;
    const key = `${round.course_id}|${s.hole_number}|${meta.player_id}`;
    const existing = agg.get(key) ?? {
      course_id: round.course_id,
      course_name: round.course_name,
      hole_number: s.hole_number,
      par: s.par,
      player_id: meta.player_id,
      display_name: meta.display_name,
      sum_gross: 0,
      plays: 0
    };
    existing.sum_gross += s.gross;
    existing.plays += 1;
    agg.set(key, existing);
  }

  // Group by (course_id, hole_number); pick the lowest-avg leader with
  // ≥minPlays.
  type HoleBucket = {
    course_id: string;
    course_name: string;
    hole_number: number;
    par: number;
    rows: Agg[];
  };
  const byHole = new Map<string, HoleBucket>();
  for (const e of agg.values()) {
    if (e.plays < minPlays) continue;
    const key = `${e.course_id}|${e.hole_number}`;
    const b = byHole.get(key) ?? {
      course_id: e.course_id,
      course_name: e.course_name,
      hole_number: e.hole_number,
      par: e.par,
      rows: []
    };
    b.rows.push(e);
    byHole.set(key, b);
  }

  const out: HoleMasterySignal[] = [];
  for (const b of byHole.values()) {
    b.rows.sort((a, c) => a.sum_gross / a.plays - c.sum_gross / c.plays);
    const leader = b.rows[0];
    if (!leader) continue;
    const avg = leader.sum_gross / leader.plays;
    out.push({
      course_id: b.course_id,
      course_name: b.course_name,
      hole_number: b.hole_number,
      par: b.par,
      leader: {
        player_id: leader.player_id,
        display_name: leader.display_name,
        avg_score: round1(avg),
        vs_par: round1(avg - b.par),
        hole_count: leader.plays
      }
    });
  }
  // Hardest-hole-first (highest leader vs_par means even the leader is
  // struggling — that's the most narratively interesting hole).
  out.sort((a, b) => b.leader.vs_par - a.leader.vs_par);
  return out;
}

/**
 * Biggest-pot signal — the single finalized round in the group's
 * history with the largest absolute cents-moved across all settlements.
 * Returns null when nothing's meaningfully large (default ≥ $50 moved).
 */
export function buildBiggestPotSignal(
  rounds: ClubhouseRound[],
  settlements: ClubhouseSettlement[],
  opts: { minCents?: number } = {}
): BiggestPotSignal | null {
  const minCents = opts.minCents ?? 5000;
  const finalizedRounds = new Map<
    string,
    { date: string; course_name: string | null }
  >();
  for (const r of rounds) {
    if (r.status !== "finalized") continue;
    finalizedRounds.set(r.id, {
      date: r.date,
      course_name: r.course_name
    });
  }
  type Pot = { round_id: string; total: number; edges: number };
  const byRound = new Map<string, Pot>();
  for (const s of settlements) {
    if (!finalizedRounds.has(s.round_id)) continue;
    const e = byRound.get(s.round_id) ?? {
      round_id: s.round_id,
      total: 0,
      edges: 0
    };
    e.total += s.amount_cents; // settlements are already absolute (positive)
    e.edges += 1;
    byRound.set(s.round_id, e);
  }
  let best: Pot | null = null;
  for (const p of byRound.values()) {
    if (p.total < minCents) continue;
    if (!best || p.total > best.total) best = p;
  }
  if (!best) return null;
  const meta = finalizedRounds.get(best.round_id)!;
  return {
    round_id: best.round_id,
    date: meta.date,
    course_name: meta.course_name,
    total_cents_moved: best.total,
    edges: best.edges
  };
}

/**
 * Career money — lifetime cents netted by each player across every
 * finalized round in the group. Sorted by net_cents desc (winners
 * first), then by rounds played desc, then by name for stability.
 *
 * The /ledger page already shows a similar list but per-round-window;
 * this signal is purely lifetime, intended for surfacing in the
 * Clubhouse strip and on player stats pages.
 */
export function buildCareerMoney(
  rps: ClubhouseRoundPlayer[],
  settlements: ClubhouseSettlement[],
  rounds: ClubhouseRound[]
): CareerMoneyEntry[] {
  const finalizedRoundIds = new Set(
    rounds.filter((r) => r.status === "finalized").map((r) => r.id)
  );
  const rpToPlayer = new Map(
    rps.map((rp) => [
      rp.round_player_id,
      { player_id: rp.player_id, display_name: rp.display_name }
    ])
  );

  const totals = new Map<
    string,
    { display_name: string; net_cents: number; round_set: Set<string> }
  >();

  // Initialize entries for every player who appears in a finalized round
  // (so a player who only ever pushed shows up at $0 with their round
  // count, rather than vanishing entirely).
  for (const rp of rps) {
    if (!finalizedRoundIds.has(rp.round_id)) continue;
    const e = totals.get(rp.player_id) ?? {
      display_name: rp.display_name,
      net_cents: 0,
      round_set: new Set<string>()
    };
    e.round_set.add(rp.round_id);
    totals.set(rp.player_id, e);
  }

  for (const s of settlements) {
    if (!finalizedRoundIds.has(s.round_id)) continue;
    const from = rpToPlayer.get(s.from_round_player_id);
    const to = rpToPlayer.get(s.to_round_player_id);
    if (from && totals.has(from.player_id)) {
      totals.get(from.player_id)!.net_cents -= s.amount_cents;
    }
    if (to && totals.has(to.player_id)) {
      totals.get(to.player_id)!.net_cents += s.amount_cents;
    }
  }

  const out: CareerMoneyEntry[] = [];
  for (const [player_id, e] of totals.entries()) {
    out.push({
      player_id,
      display_name: e.display_name,
      net_cents: e.net_cents,
      rounds: e.round_set.size
    });
  }
  out.sort((a, b) => {
    if (b.net_cents !== a.net_cents) return b.net_cents - a.net_cents;
    if (b.rounds !== a.rounds) return b.rounds - a.rounds;
    return a.display_name.localeCompare(b.display_name);
  });
  return out;
}

/**
 * Most-recent finalized round signal — small "what just happened"
 * summary for the dashboard. Returns null when no finalized rounds.
 */
export function buildLastRoundSignal(
  rounds: ClubhouseRound[],
  rps: ClubhouseRoundPlayer[],
  scores: ClubhouseScore[],
  settlements: ClubhouseSettlement[]
): LastRoundSignal | null {
  const finalized = rounds.filter((r) => r.status === "finalized");
  if (finalized.length === 0) return null;
  finalized.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const last = finalized[0];

  const lastRps = rps.filter((rp) => rp.round_id === last.id);
  const lastRpIds = new Set(lastRps.map((rp) => rp.round_player_id));

  // Leader: lowest gross-vs-par across the round.
  let leader: LastRoundSignal["leader"] = null;
  for (const rp of lastRps) {
    const rpScores = scores.filter(
      (s) => s.round_player_id === rp.round_player_id && s.gross != null
    );
    if (rpScores.length === 0) continue;
    const gross = rpScores.reduce((s, x) => s + (x.gross as number), 0);
    const par = rpScores.reduce((s, x) => s + x.par, 0);
    const relative = gross - par;
    if (
      leader == null ||
      relative < leader.relative_to_par ||
      (relative === leader.relative_to_par && gross < leader.gross)
    ) {
      leader = {
        player_id: rp.player_id,
        display_name: rp.display_name,
        relative_to_par: relative,
        gross
      };
    }
  }

  // Biggest winner / loser by settlement net.
  const rpToPlayer = new Map(
    lastRps.map((rp) => [
      rp.round_player_id,
      { player_id: rp.player_id, display_name: rp.display_name }
    ])
  );
  const netByPlayer = new Map<
    string,
    { display_name: string; net_cents: number }
  >();
  let totalCents = 0;
  let edges = 0;
  for (const s of settlements) {
    if (!lastRpIds.has(s.from_round_player_id)) continue;
    if (!lastRpIds.has(s.to_round_player_id)) continue;
    const from = rpToPlayer.get(s.from_round_player_id)!;
    const to = rpToPlayer.get(s.to_round_player_id)!;
    const fromEntry = netByPlayer.get(from.player_id) ?? {
      display_name: from.display_name,
      net_cents: 0
    };
    fromEntry.net_cents -= s.amount_cents;
    netByPlayer.set(from.player_id, fromEntry);
    const toEntry = netByPlayer.get(to.player_id) ?? {
      display_name: to.display_name,
      net_cents: 0
    };
    toEntry.net_cents += s.amount_cents;
    netByPlayer.set(to.player_id, toEntry);
    totalCents += s.amount_cents;
    edges += 1;
  }

  let biggestWinner: LastRoundSignal["biggest_winner"] = null;
  let biggestLoser: LastRoundSignal["biggest_loser"] = null;
  for (const [player_id, e] of netByPlayer.entries()) {
    if (e.net_cents > 0 && (!biggestWinner || e.net_cents > biggestWinner.net_cents)) {
      biggestWinner = { player_id, display_name: e.display_name, net_cents: e.net_cents };
    }
    if (e.net_cents < 0 && (!biggestLoser || e.net_cents < biggestLoser.net_cents)) {
      biggestLoser = { player_id, display_name: e.display_name, net_cents: e.net_cents };
    }
  }

  return {
    round_id: last.id,
    date: last.date,
    course_name: last.course_name,
    leader,
    biggest_winner: biggestWinner,
    biggest_loser: biggestLoser,
    total_cents_moved: totalCents,
    edges
  };
}

// ---- Convenience: combined builder ----

export function buildClubhouse(input: {
  group_name: string;
  rounds: ClubhouseRound[];
  rps: ClubhouseRoundPlayer[];
  scores: ClubhouseScore[];
  settlements: ClubhouseSettlement[];
  /** Used for the rolling activity window only. Lifetime totals always
   *  use the full input. */
  windowDays?: number;
  today?: string;
  minStreak?: number;
  minRivalryRounds?: number;
  minPartnerRounds?: number;
  minMasteryRounds?: number;
  /** Lookback for "recent milestones" — defaults to 14 days. */
  milestoneWindowDays?: number;
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
    }),
    rivalries: buildRivalrySignals(input.rps, input.settlements, input.rounds, {
      minRounds: input.minRivalryRounds
    }),
    partners: buildPartnerSignals(input.rps, input.settlements, input.rounds, {
      minRounds: input.minPartnerRounds
    }),
    lifetime: buildGroupLifetimeSignal(input.rounds, input.settlements, {
      today: input.today
    }),
    course_mastery: buildCourseMasterySignals(input.rounds, input.rps, input.scores, {
      minRounds: input.minMasteryRounds
    }),
    hole_mastery: buildHoleMasterySignals(input.rounds, input.rps, input.scores),
    biggest_pot: buildBiggestPotSignal(input.rounds, input.settlements),
    career_money: buildCareerMoney(input.rps, input.settlements, input.rounds),
    last_round: buildLastRoundSignal(
      input.rounds,
      input.rps,
      input.scores,
      input.settlements
    ),
    recent_milestones: buildRecentMilestones(input.rounds, input.rps, input.scores, {
      windowDays: input.milestoneWindowDays,
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

function daysBetween(isoStart: string, isoEnd: string): number {
  const [y1, m1, d1] = isoStart.split("-").map(Number);
  const [y2, m2, d2] = isoEnd.split("-").map(Number);
  const a = Date.UTC(y1, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Format a years/months span understatedly: "4 years", "8 months",
 *  "3 weeks". Used by the lifetime card. Returns null for zero/negative
 *  spans so callers can skip rendering. */
export function fmtGroupSpan(days: number): string | null {
  if (days <= 0) return null;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  // Round to one decimal year for spans where partial years matter.
  const years = days / 365;
  if (years < 1.95) return "1 year"; // Avoid "2.0 years" right at the threshold.
  return `${years.toFixed(years < 10 ? 1 : 0).replace(/\.0$/, "")} years`;
}

export function fmtRelativeToPar(n: number): string {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`; // negative number already has its sign
}

export function fmtMoneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
