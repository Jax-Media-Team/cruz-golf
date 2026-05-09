/**
 * Leaderboard / season-stat computations.
 *
 * Pure: takes raw round + score + settlement rows and returns ranked lists.
 * No DB, no React. Runs server-side or in tests.
 */
import { bucketFor } from "./stats";

export type StatRound = {
  round_id: string;
  round_date: string; // ISO yyyy-mm-dd
  course_name: string | null;
  status: "draft" | "live" | "finalized";
  group_id: string;
  holes: number;
};

export type StatRoundPlayer = {
  round_player_id: string;
  round_id: string;
  player_id: string;
  display_name: string;
  team_id: string | null;
  course_handicap: number;
  playing_handicap: number;
};

export type StatScore = {
  round_player_id: string;
  hole_number: number;
  par: number;
  gross: number | null;
  strokes_received: number;
};

export type StatSettlement = {
  round_id: string;
  from_round_player_id: string;
  to_round_player_id: string;
  amount_cents: number;
};

export type StatGameAward = {
  round_id: string;
  round_player_id: string;
  game_type: string;
  /** count of skins (or whatever unit) won */
  count: number;
};

export type PlayerStats = {
  player_id: string;
  display_name: string;
  rounds: number;
  rounds_18: number;
  rounds_9: number;
  /** Most recent round's date, ISO. */
  last_played: string | null;
  total_gross: number;
  total_par_played: number;
  avg_gross_per_round: number; // 18-hole equivalent
  best_gross: number | null;
  worst_gross: number | null;
  birdies: number;
  pars: number;
  bogeys: number;
  doubles_or_worse: number;
  eagles_or_better: number;
  /** Net winnings across all settled rounds in cents. Positive = won money. */
  money_cents: number;
  biggest_win_cents: number;
  biggest_loss_cents: number;
  rounds_won_money: number;
  rounds_lost_money: number;
  /** Hot streak: consecutive recent rounds where money_cents > 0. */
  hot_streak: number;
  /** Cold streak: consecutive recent rounds where money_cents < 0. */
  cold_streak: number;
};

export type LeaderboardRow<T = unknown> = {
  player_id: string;
  display_name: string;
  /** The primary sort/display value. */
  value: number;
  /** Optional secondary metric (e.g. money in birdie board). */
  meta?: string;
  extra?: T;
};

export type Leaderboards = {
  money: LeaderboardRow[];
  birdies: LeaderboardRow[];
  skins: LeaderboardRow[];
  hot: LeaderboardRow[];
  cold: LeaderboardRow[];
  best_round: LeaderboardRow[];
  win_rate: LeaderboardRow[];
  money_per_round: LeaderboardRow[];
  most_active: LeaderboardRow[];
};

/** Compute per-player stats across an entire group's history. */
export function buildPlayerStats(input: {
  rounds: StatRound[];
  roundPlayers: StatRoundPlayer[];
  scores: StatScore[];
  settlements: StatSettlement[];
}): PlayerStats[] {
  const finalized = new Set(
    input.rounds.filter((r) => r.status === "finalized").map((r) => r.round_id)
  );
  const roundDate = new Map(input.rounds.map((r) => [r.round_id, r.round_date]));
  const roundHoles = new Map(input.rounds.map((r) => [r.round_id, r.holes]));

  // Group round_players by player_id
  const rpByPlayer = new Map<string, StatRoundPlayer[]>();
  for (const rp of input.roundPlayers) {
    const arr = rpByPlayer.get(rp.player_id) ?? [];
    arr.push(rp);
    rpByPlayer.set(rp.player_id, arr);
  }
  const rpToPlayer = new Map(input.roundPlayers.map((rp) => [rp.round_player_id, rp.player_id]));
  const rpToRound = new Map(input.roundPlayers.map((rp) => [rp.round_player_id, rp.round_id]));

  // Index scores by round_player_id
  const scoresByRp = new Map<string, StatScore[]>();
  for (const s of input.scores) {
    if (s.gross == null) continue;
    const arr = scoresByRp.get(s.round_player_id) ?? [];
    arr.push(s);
    scoresByRp.set(s.round_player_id, arr);
  }

  // Settlement -> per-player money per round (cents)
  const moneyByRpRound = new Map<string, number>(); // key = `${round_id}:${player_id}`
  for (const set of input.settlements) {
    if (!finalized.has(set.round_id)) continue;
    const fromPlayer = rpToPlayer.get(set.from_round_player_id);
    const toPlayer = rpToPlayer.get(set.to_round_player_id);
    if (fromPlayer) {
      const k = `${set.round_id}:${fromPlayer}`;
      moneyByRpRound.set(k, (moneyByRpRound.get(k) ?? 0) - set.amount_cents);
    }
    if (toPlayer) {
      const k = `${set.round_id}:${toPlayer}`;
      moneyByRpRound.set(k, (moneyByRpRound.get(k) ?? 0) + set.amount_cents);
    }
  }

  const results: PlayerStats[] = [];
  for (const [player_id, rps] of rpByPlayer) {
    const display_name = rps[0].display_name;

    let rounds = 0;
    let rounds_18 = 0;
    let rounds_9 = 0;
    let lastPlayed: string | null = null;
    let total_gross = 0;
    let total_par = 0;
    let best_gross: number | null = null;
    let worst_gross: number | null = null;
    let birdies = 0,
      pars = 0,
      bogeys = 0,
      doubles_or_worse = 0,
      eagles_or_better = 0;

    // Money per round (chronological)
    const moneyTimeline: Array<{ date: string; cents: number }> = [];

    for (const rp of rps) {
      const date = roundDate.get(rp.round_id);
      const holes = roundHoles.get(rp.round_id) ?? 18;
      if (!finalized.has(rp.round_id)) continue;

      rounds += 1;
      if (holes === 9) rounds_9 += 1;
      else rounds_18 += 1;
      if (date && (lastPlayed == null || date > lastPlayed)) lastPlayed = date;

      const playerScores = scoresByRp.get(rp.round_player_id) ?? [];
      let roundGross = 0;
      let roundPar = 0;
      for (const s of playerScores) {
        if (s.gross == null) continue;
        roundGross += s.gross;
        roundPar += s.par;
        const b = bucketFor(s.gross, s.par);
        if (b === "eagle_or_better") eagles_or_better += 1;
        else if (b === "birdie") birdies += 1;
        else if (b === "par") pars += 1;
        else if (b === "bogey") bogeys += 1;
        else doubles_or_worse += 1;
      }
      if (playerScores.length > 0) {
        // Normalize to 18-hole equivalent for averaging
        const norm = holes === 9 ? roundGross * 2 : roundGross;
        if (best_gross == null || norm < best_gross) best_gross = norm;
        if (worst_gross == null || norm > worst_gross) worst_gross = norm;
      }
      total_gross += roundGross;
      total_par += roundPar;

      const money = moneyByRpRound.get(`${rp.round_id}:${player_id}`) ?? 0;
      if (date) moneyTimeline.push({ date, cents: money });
    }

    const totalCents = moneyTimeline.reduce((s, m) => s + m.cents, 0);
    const wins = moneyTimeline.filter((m) => m.cents > 0).length;
    const losses = moneyTimeline.filter((m) => m.cents < 0).length;
    const biggest_win_cents = moneyTimeline.reduce((m, x) => Math.max(m, x.cents), 0);
    const biggest_loss_cents = moneyTimeline.reduce((m, x) => Math.min(m, x.cents), 0);

    // Hot/cold streak — chronological tail
    moneyTimeline.sort((a, b) => a.date.localeCompare(b.date));
    let hot = 0,
      cold = 0;
    for (let i = moneyTimeline.length - 1; i >= 0; i--) {
      const m = moneyTimeline[i].cents;
      if (m > 0 && cold === 0) hot += 1;
      else if (m < 0 && hot === 0) cold += 1;
      else break;
    }

    const avg = rounds > 0 ? total_gross / Math.max(1, rounds_18 + rounds_9 * 0.5) : 0;

    results.push({
      player_id,
      display_name,
      rounds,
      rounds_18,
      rounds_9,
      last_played: lastPlayed,
      total_gross,
      total_par_played: total_par,
      avg_gross_per_round: avg,
      best_gross,
      worst_gross,
      birdies,
      pars,
      bogeys,
      doubles_or_worse,
      eagles_or_better,
      money_cents: totalCents,
      biggest_win_cents,
      biggest_loss_cents,
      rounds_won_money: wins,
      rounds_lost_money: losses,
      hot_streak: hot,
      cold_streak: cold
    });
  }

  return results;
}

/** Build the various leaderboards from per-player stats + game awards. */
export function buildLeaderboards(
  stats: PlayerStats[],
  skinsByPlayer: Map<string, number> = new Map()
): Leaderboards {
  const eligible = stats.filter((s) => s.rounds > 0);

  return {
    money: eligible
      .slice()
      .sort((a, b) => b.money_cents - a.money_cents)
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.money_cents,
        meta: `${s.rounds_won_money}W / ${s.rounds_lost_money}L · ${s.rounds} rounds`
      })),
    birdies: eligible
      .slice()
      .sort((a, b) => b.birdies / Math.max(1, a.rounds) - a.birdies / Math.max(1, b.rounds))
      .sort((a, b) => b.birdies - a.birdies)
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.birdies,
        meta: `${(s.birdies / Math.max(1, s.rounds)).toFixed(1)}/round · ${s.rounds} rounds`
      })),
    skins: [...skinsByPlayer.entries()]
      .map(([pid, count]) => {
        const s = stats.find((x) => x.player_id === pid);
        return {
          player_id: pid,
          display_name: s?.display_name ?? pid,
          value: count,
          meta: s ? `${s.rounds} rounds` : ""
        };
      })
      .sort((a, b) => b.value - a.value),
    hot: eligible
      .slice()
      .filter((s) => s.hot_streak > 0)
      .sort((a, b) => b.hot_streak - a.hot_streak)
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.hot_streak,
        meta: `won last ${s.hot_streak}`
      })),
    cold: eligible
      .slice()
      .filter((s) => s.cold_streak > 0)
      .sort((a, b) => b.cold_streak - a.cold_streak)
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.cold_streak,
        meta: `lost last ${s.cold_streak}`
      })),
    best_round: eligible
      .filter((s) => s.best_gross != null)
      .slice()
      .sort((a, b) => (a.best_gross ?? 1e9) - (b.best_gross ?? 1e9))
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.best_gross ?? 0,
        meta: `over ${s.rounds} round${s.rounds === 1 ? "" : "s"}`
      })),
    win_rate: eligible
      .filter((s) => s.rounds_won_money + s.rounds_lost_money > 0)
      .slice()
      .sort((a, b) => {
        const aRate = a.rounds_won_money / Math.max(1, a.rounds_won_money + a.rounds_lost_money);
        const bRate = b.rounds_won_money / Math.max(1, b.rounds_won_money + b.rounds_lost_money);
        return bRate - aRate;
      })
      .map((s) => {
        const decided = s.rounds_won_money + s.rounds_lost_money;
        const pct = decided > 0 ? (s.rounds_won_money / decided) * 100 : 0;
        return {
          player_id: s.player_id,
          display_name: s.display_name,
          value: Math.round(pct),
          meta: `${s.rounds_won_money}W / ${s.rounds_lost_money}L`
        };
      }),
    money_per_round: eligible
      .filter((s) => s.rounds > 0)
      .slice()
      .sort((a, b) => b.money_cents / Math.max(1, b.rounds) - a.money_cents / Math.max(1, a.rounds))
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: Math.round(s.money_cents / Math.max(1, s.rounds)),
        meta: `${s.rounds} rounds`
      })),
    most_active: eligible
      .slice()
      .sort((a, b) => b.rounds - a.rounds)
      .map((s) => ({
        player_id: s.player_id,
        display_name: s.display_name,
        value: s.rounds,
        meta: s.last_played ? `last ${s.last_played}` : ""
      }))
  };
}
