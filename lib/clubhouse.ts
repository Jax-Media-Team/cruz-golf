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

export type ClubhouseBundle = {
  group_name: string;
  live_rounds: LiveRoundSignal[];
  streaks: StreakSignal[];
  activity: GroupActivitySignal;
  rivalries: RivalrySignal[];
  partners: PartnerSignal[];
  lifetime: GroupLifetimeSignal;
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
