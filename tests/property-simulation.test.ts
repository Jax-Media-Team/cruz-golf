/**
 * Property-based stress test.
 *
 * Generates many random rounds with mixed game configurations and asserts
 * the deepest engine invariants:
 *   1. Each game's per-player deltas sum to zero (zero-sum invariant)
 *   2. minimumFlow() exactly settles every player to zero
 *   3. Total money in == total money out for every aggregated round
 *   4. No player can be both the source and destination of the same flow
 *   5. Every settlement amount is a positive integer (no fractional cents)
 *
 * Tries 200 randomized scenarios across:
 *   - 2 to 8 players, varied handicaps
 *   - 9 or 18 holes
 *   - 1 to 4 simultaneous games per round
 *   - Varied stakes ($1 to $100)
 *   - All major game types
 */
import { describe, expect, it } from "vitest";
import { settleGame, minimumFlow } from "@/lib/games";
import type {
  GameInput,
  GameOutput,
  GameType,
  RoundGame,
  RoundPlayer,
  Score,
  UUID
} from "@/lib/types";
import { makeHoles, makePlayer } from "./fixtures";

function xorshift(seed: number) {
  let s = seed | 0;
  return function rand() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

function generateRound(seed: number): {
  players: RoundPlayer[];
  scores: Score[];
  games: RoundGame[];
  totalHoles: 9 | 18;
} {
  const rnd = xorshift(seed * 1009 + 11);
  const playerCount = 2 + Math.floor(rnd() * 7); // 2..8
  const totalHoles: 9 | 18 = rnd() > 0.5 ? 18 : 9;
  const holes = makeHoles().slice(0, totalHoles);

  const players: RoundPlayer[] = [];
  const teamCount = rnd() > 0.5 ? 2 : 0; // half the time, assign teams
  for (let i = 0; i < playerCount; i++) {
    const id = `rp-${seed}-${i}` as UUID;
    const ph = Math.floor(rnd() * 30); // 0..29
    const player = makePlayer({
      id,
      name: `Player ${i + 1}`,
      playing_handicap: ph,
      team_id:
        teamCount > 0
          ? (`team-${i % teamCount}` as UUID)
          : null
    });
    // Truncate the player's tee.holes to match totalHoles
    player.tee = { ...player.tee, holes };
    players.push(player);
  }

  const scores: Score[] = [];
  for (const p of players) {
    for (const h of holes) {
      const par = h.par;
      const offset = Math.floor(rnd() * 6) - 1; // -1..+4
      // Sometimes leave a hole blank (DNF) — 10% chance
      if (rnd() < 0.1) {
        scores.push({ round_player_id: p.id, hole_number: h.hole_number, gross: null });
      } else {
        scores.push({
          round_player_id: p.id,
          hole_number: h.hole_number,
          gross: Math.max(2, par + offset)
        });
      }
    }
  }

  const allGameTypes: GameType[] = [
    "individual_gross",
    "individual_net",
    "best_ball_gross",
    "best_ball_net",
    "aggregate_gross",
    "aggregate_net",
    "skins_gross",
    "skins_net",
    "skins_canadian",
    "nassau",
    "match_play",
    "six_six_six"
  ];
  const gameCount = 1 + Math.floor(rnd() * 4); // 1..4 games
  const games: RoundGame[] = [];
  for (let g = 0; g < gameCount; g++) {
    const type: GameType = pick(allGameTypes, rnd);
    // Skip games that need exact-4 players if we don't have exactly 4
    if (type === "six_six_six" && playerCount !== 4) continue;
    if (
      (type === "best_ball_gross" || type === "best_ball_net" ||
       type === "aggregate_gross" || type === "aggregate_net" ||
       type === "match_play") &&
      teamCount === 0
    ) continue;

    const stakeCents = (1 + Math.floor(rnd() * 100)) * 100; // $1..$100
    games.push({
      id: `g-${seed}-${g}`,
      round_id: `r-${seed}` as UUID,
      game_type: type,
      name: `Game ${g}`,
      stake_cents: type === "nassau" ? 0 : stakeCents,
      allowance_pct: pick([85, 90, 95, 100], rnd),
      config: type === "nassau"
        ? {
            front_stake_cents: stakeCents,
            back_stake_cents: stakeCents,
            overall_stake_cents: stakeCents,
            match_play: rnd() > 0.5,
            presses_enabled: rnd() > 0.5
          }
        : type.startsWith("skins")
        ? rnd() > 0.5
          ? { skin_mode: "pot", buyin_cents: 2000, ties: "carry" }
          : { skin_mode: "fixed", skin_value_cents: stakeCents, ties: "carry", escalation: "linear" }
        : {}
    });
  }

  return { players, scores, games, totalHoles };
}

function runRound(input: ReturnType<typeof generateRound>) {
  const { players, scores, games, totalHoles } = input;
  const holes = players[0].tee.holes;
  const par = holes.reduce((s, h) => s + h.par, 0);

  const outputs: GameOutput[] = [];
  for (const game of games) {
    const gameInput: GameInput = {
      game,
      players,
      scores,
      course: { holes, par },
      totalHoles,
      startingHole: 1
    };
    outputs.push(settleGame(gameInput));
  }
  return outputs;
}

describe("property-based round simulation (200 scenarios)", () => {
  it("zero-sum invariant: every game settles to delta=0 across all players", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const round = generateRound(seed);
      if (round.games.length === 0) continue;
      const outputs = runRound(round);
      for (const out of outputs) {
        let total = 0;
        for (const v of out.perPlayer.values()) total += v.delta_cents;
        expect(
          total,
          `seed ${seed}: game-level zero-sum violated (sum=${total})`
        ).toBe(0);
      }
    }
  });

  it("minimumFlow exactly drains every player's net to zero", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const round = generateRound(seed);
      if (round.games.length === 0) continue;
      const outputs = runRound(round);

      const totals = new Map<UUID, number>();
      for (const o of outputs) {
        for (const [pid, v] of o.perPlayer) {
          totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
        }
      }
      const flows = minimumFlow(totals);
      // Apply flows: subtract from from, add to to.
      const after = new Map(totals);
      for (const f of flows) {
        after.set(f.from, (after.get(f.from) ?? 0) + f.amount_cents);
        after.set(f.to, (after.get(f.to) ?? 0) - f.amount_cents);
      }
      for (const [pid, bal] of after) {
        expect(
          bal,
          `seed ${seed}: ${pid} did not settle to zero (residual=${bal})`
        ).toBe(0);
      }
    }
  });

  it("no flow has the same player as both source and destination", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const round = generateRound(seed);
      if (round.games.length === 0) continue;
      const outputs = runRound(round);
      const totals = new Map<UUID, number>();
      for (const o of outputs) {
        for (const [pid, v] of o.perPlayer) {
          totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
        }
      }
      const flows = minimumFlow(totals);
      for (const f of flows) {
        expect(f.from).not.toBe(f.to);
      }
    }
  });

  it("every settlement amount is a positive integer (no fractional cents)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const round = generateRound(seed);
      if (round.games.length === 0) continue;
      const outputs = runRound(round);
      const totals = new Map<UUID, number>();
      for (const o of outputs) {
        for (const [pid, v] of o.perPlayer) {
          totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
        }
      }
      const flows = minimumFlow(totals);
      for (const f of flows) {
        expect(Number.isInteger(f.amount_cents)).toBe(true);
        expect(f.amount_cents).toBeGreaterThan(0);
      }
    }
  });

  it("aggregate per-player money in == aggregate money out for every round", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const round = generateRound(seed);
      if (round.games.length === 0) continue;
      const outputs = runRound(round);
      let totalIn = 0;
      let totalOut = 0;
      for (const o of outputs) {
        for (const v of o.perPlayer.values()) {
          if (v.delta_cents > 0) totalIn += v.delta_cents;
          else if (v.delta_cents < 0) totalOut += -v.delta_cents;
        }
      }
      expect(totalIn).toBe(totalOut);
    }
  });
});
