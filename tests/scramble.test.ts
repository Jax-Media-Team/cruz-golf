/**
 * Scramble settlement coverage.
 *
 * Polish-phase priority: scramble is a top-3 member-member tournament
 * format and was completely uncovered by tests. The engine routes
 * scramble_gross / scramble_net through the same `settleTeamGame(...,
 * "best_ball", ...)` path used by Best Ball, so the math is identical:
 * each team's hole score = min(member scores).
 *
 * In a TRUE scramble, every team member records the same gross on each
 * hole (one ball, one lie). The engine handles either case — same-
 * scores or differing-scores — because it just takes the min.
 *
 * Tests verify:
 *   - 2v2 scramble with identical per-team scores settles correctly
 *   - 2v2 scramble with differing per-team scores (one player forgot
 *     to enter, or entered their individual score by accident) still
 *     settles via min — the engine is forgiving
 *   - 4v4 scramble (big member-member style) settles zero-sum
 *   - Net scramble respects allowance %
 *   - Halved scramble produces no money flow
 */
import { describe, it, expect } from "vitest";
import { settleGame } from "@/lib/games";
import {
  makeGame,
  makeHoles,
  makeInput,
  makePlayer,
  makeScores
} from "./fixtures";
import type { GameOutput, UUID } from "@/lib/types";

function sumDeltas(out: GameOutput): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

function deltaFor(out: GameOutput, rpId: UUID): number {
  return out.perPlayer.get(rpId)?.delta_cents ?? 0;
}

// 18-hole par-72 layout
const JGCC_PARS = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5];
const PAR_TOTAL = JGCC_PARS.reduce((a, b) => a + b, 0); // 72

describe("scramble: 2v2, identical per-team scores (true scramble pattern)", () => {
  const players = [
    makePlayer({
      id: "rp-a1",
      name: "Patrick",
      playing_handicap: 8,
      team_id: "team-a"
    }),
    makePlayer({
      id: "rp-a2",
      name: "Ben",
      playing_handicap: 12,
      team_id: "team-a"
    }),
    makePlayer({
      id: "rp-b1",
      name: "Mitch",
      playing_handicap: 6,
      team_id: "team-b"
    }),
    makePlayer({
      id: "rp-b2",
      name: "Kyle",
      playing_handicap: 10,
      team_id: "team-b"
    })
  ];
  // True scramble: each team member writes the team's gross on every
  // hole. Team A shoots 70 (8 birdies), Team B shoots 74 (2 birdies).
  const teamAGrosses = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5]; // 66
  const teamBGrosses = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5]; // 73

  const scores = makeScores({
    "rp-a1": teamAGrosses,
    "rp-a2": teamAGrosses,
    "rp-b1": teamBGrosses,
    "rp-b2": teamBGrosses
  });

  it("settles A-positive when team A shoots lower (gross)", () => {
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          name: "Scramble (gross)",
          stake_cents: 2000
        }),
        players,
        scores
      })
    );
    // Zero-sum
    expect(sumDeltas(out)).toBe(0);
    // Team A wins → each A player positive, each B player negative
    expect(deltaFor(out, "rp-a1")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-a2")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-b1")).toBeLessThan(0);
    expect(deltaFor(out, "rp-b2")).toBeLessThan(0);
  });

  it("net scramble with 85% allowance still settles zero-sum + correct direction", () => {
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_net",
          name: "Scramble (net)",
          stake_cents: 2000,
          allowance_pct: 85
        }),
        players,
        scores
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Even with handicaps, A's gross 66 vs B's 73 means A still wins net.
    expect(deltaFor(out, "rp-a1")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-b1")).toBeLessThan(0);
  });
});

describe("scramble: one-entry-per-team semantics (matches real golf-group behavior)", () => {
  // SCRAMBLE-ONE-ENTRY (resolved 2026-05-11): in real scramble play the
  // scorer typically writes ONE shared team score per hole — not "each
  // player records their own card." The engine's "scramble" variant
  // tolerates partial entry: as long as at least one team member
  // entered a score, the hole settles using min(entered scores).
  //
  // Best ball still requires every member to record (each plays own
  // ball). The contrast is intentional and tested below in the
  // best-ball regression block at the bottom of this file.

  it("if only one team member records each hole, the team still settles correctly", () => {
    // Patrick records every hole for team A. Ben enters nothing —
    // typical scramble pattern where one player is the scorer.
    // Same on team B (Mitch is the scorer; Kyle enters nothing).
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    const patScores = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5]; // 66
    const benScores: (number | null)[] = Array(18).fill(null);
    const mitScores = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5]; // 73
    const kylScores: (number | null)[] = Array(18).fill(null);
    const scores = [
      ...patScores.map((g, i) => ({
        round_player_id: "rp-a1",
        hole_number: i + 1,
        gross: g
      })),
      ...benScores.map((g, i) => ({
        round_player_id: "rp-a2",
        hole_number: i + 1,
        gross: g
      })),
      ...mitScores.map((g, i) => ({
        round_player_id: "rp-b1",
        hole_number: i + 1,
        gross: g
      })),
      ...kylScores.map((g, i) => ({
        round_player_id: "rp-b2",
        hole_number: i + 1,
        gross: g
      }))
    ];
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    // Team A's 66 vs Team B's 73 — Team A wins by 7 strokes.
    // Both teams settle even though only one player per team entered.
    expect(sumDeltas(out)).toBe(0);
    // Each B player loses $10. Pot $20 to A → +$10 each.
    expect(deltaFor(out, "rp-a1")).toBe(1000);
    expect(deltaFor(out, "rp-a2")).toBe(1000);
    expect(deltaFor(out, "rp-b1")).toBe(-1000);
    expect(deltaFor(out, "rp-b2")).toBe(-1000);
  });

  it("if Patrick + Ben BOTH record (group-pad pattern), result is identical", () => {
    // Patrick and Ben both tap the same scores per hole (because the
    // /score-group pad asks for every player on every hole). The
    // engine takes min(both), which equals the shared value.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    const teamA = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5];
    const teamB = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5];
    const scores = makeScores({
      "rp-a1": teamA,
      "rp-a2": teamA,
      "rp-b1": teamB,
      "rp-b2": teamB
    });
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    // Identical settlement to the one-entry version above.
    expect(sumDeltas(out)).toBe(0);
    expect(deltaFor(out, "rp-a1")).toBe(1000);
    expect(deltaFor(out, "rp-a2")).toBe(1000);
    expect(deltaFor(out, "rp-b1")).toBe(-1000);
    expect(deltaFor(out, "rp-b2")).toBe(-1000);
  });

  it("MIXED ENTRY: if Patrick scores 4 and Ben scores 3 on the same hole, team uses 3 (min)", () => {
    // Reality check: the group-pad lets each player tap any number.
    // If two team members enter DIFFERENT numbers (one mis-tap), the
    // engine takes the lower as the team score — same as best ball.
    // This is the "forgiving" behavior: a fat-finger entry never
    // inflates the team's score above what was actually recorded.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    // Hole 1: pat 4, ben 3 → team A min = 3. Hole 2-18 both at par.
    const patScores = [...JGCC_PARS]; // pars all 18
    const benScores = JGCC_PARS.map((p, i) => (i === 0 ? p - 1 : p)); // birdie hole 1
    const teamB = JGCC_PARS.map((p) => p);
    const scores = [
      ...patScores.map((g, i) => ({
        round_player_id: "rp-a1",
        hole_number: i + 1,
        gross: g
      })),
      ...benScores.map((g, i) => ({
        round_player_id: "rp-a2",
        hole_number: i + 1,
        gross: g
      })),
      ...teamB.map((g, i) => ({
        round_player_id: "rp-b1",
        hole_number: i + 1,
        gross: g
      })),
      ...teamB.map((g, i) => ({
        round_player_id: "rp-b2",
        hole_number: i + 1,
        gross: g
      }))
    ];
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    // Team A shoots 71 (one birdie via min), Team B shoots 72.
    expect(sumDeltas(out)).toBe(0);
    expect(deltaFor(out, "rp-a1")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-b1")).toBeLessThan(0);
  });

  it("a hole where NO team member entered → that hole drops, rest still settles", () => {
    // Real scenario: scorer skipped writing the team's score on hole 7
    // (got busy walking off the green, forgot). 17 holes are recorded.
    // The hole 7 drops; the engine settles based on the 17 it has.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    // Team A scores: birdie holes 1, 3, 5 (saves 3 strokes); par rest
    // → 69 over the 17 recorded holes. Hole 7 (par 5) skipped → ignored.
    const teamA = JGCC_PARS.map((p, i) => {
      if (i === 6) return null; // hole 7 skipped
      if (i === 0 || i === 2 || i === 4) return p - 1; // birdie
      return p;
    });
    const teamB = JGCC_PARS.map((p, i) => (i === 6 ? null : p));
    const scores = [
      ...teamA.map((g, i) => ({
        round_player_id: "rp-a1",
        hole_number: i + 1,
        gross: g
      })),
      // Ben records nothing — pure one-entry-per-team
      ...Array(18)
        .fill(null)
        .map((_, i) => ({
          round_player_id: "rp-a2",
          hole_number: i + 1,
          gross: null as number | null
        })),
      ...teamB.map((g, i) => ({
        round_player_id: "rp-b1",
        hole_number: i + 1,
        gross: g
      })),
      ...Array(18)
        .fill(null)
        .map((_, i) => ({
          round_player_id: "rp-b2",
          hole_number: i + 1,
          gross: null as number | null
        }))
    ];
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    // Team A has 3 birdies, Team B has none. Across 17 holes A wins.
    expect(sumDeltas(out)).toBe(0);
    expect(deltaFor(out, "rp-a1")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-b1")).toBeLessThan(0);
  });

  it("BEST BALL regression: missing member scores still BLOCK settlement (each plays own ball)", () => {
    // Critical contrast: best ball must NOT inherit scramble's
    // relaxation. Each best-ball player plays their own ball; if Ben
    // didn't enter, his ball isn't represented — settling on Patrick
    // alone would silently misrepresent the team. So best ball stays
    // strict.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    const patScores = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5];
    const benScores: (number | null)[] = Array(18).fill(null);
    const teamB = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5];
    const scores = [
      ...patScores.map((g, i) => ({
        round_player_id: "rp-a1",
        hole_number: i + 1,
        gross: g
      })),
      ...benScores.map((g, i) => ({
        round_player_id: "rp-a2",
        hole_number: i + 1,
        gross: g
      })),
      ...teamB.map((g, i) => ({
        round_player_id: "rp-b1",
        hole_number: i + 1,
        gross: g
      })),
      ...teamB.map((g, i) => ({
        round_player_id: "rp-b2",
        hole_number: i + 1,
        gross: g
      }))
    ];
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "best_ball_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    // Best ball: Ben's missing scores block every hole on team A. No
    // settlement. (Workaround for real best-ball play: every player
    // must record their own card.)
    expect(sumDeltas(out)).toBe(0);
    expect(deltaFor(out, "rp-a1")).toBe(0);
    expect(deltaFor(out, "rp-b1")).toBe(0);
  });

  it("if one member shoots better than another on a hole, team uses the lower", () => {
    // Hole 1: Patrick 4, Ben 3 → team A score = 3
    // Hole 2: Patrick 3, Ben 4 → team A score = 3
    // Team B shoots 4 every hole → team A wins every hole on A's 3,
    // and pushes when both shoot 4+ elsewhere.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    const patScores = JGCC_PARS.map((p, i) => (i === 0 ? p : p)); // par
    const benScores = JGCC_PARS.map((p, i) => (i === 0 ? p - 1 : p)); // birdie hole 1, par rest
    const teamBScores = JGCC_PARS.map((p) => p); // par all
    const scores = [
      ...patScores.map((g, i) => ({
        round_player_id: "rp-a1",
        hole_number: i + 1,
        gross: g
      })),
      ...benScores.map((g, i) => ({
        round_player_id: "rp-a2",
        hole_number: i + 1,
        gross: g
      })),
      ...teamBScores.map((g, i) => ({
        round_player_id: "rp-b1",
        hole_number: i + 1,
        gross: g
      })),
      ...teamBScores.map((g, i) => ({
        round_player_id: "rp-b2",
        hole_number: i + 1,
        gross: g
      }))
    ];
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 1000
        }),
        players,
        scores
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Team A wins overall: A shot 71 (one birdie), B shot 72.
    expect(deltaFor(out, "rp-a1")).toBeGreaterThan(0);
    expect(deltaFor(out, "rp-b1")).toBeLessThan(0);
  });
});

describe("scramble: 4v4 (big member-member tournament style)", () => {
  it("8 players, 2 teams of 4 — settles zero-sum + correct direction", () => {
    const teamA = ["rp-a1", "rp-a2", "rp-a3", "rp-a4"].map((id) =>
      makePlayer({ id, name: id, team_id: "team-a" })
    );
    const teamB = ["rp-b1", "rp-b2", "rp-b3", "rp-b4"].map((id) =>
      makePlayer({ id, name: id, team_id: "team-b" })
    );
    const players = [...teamA, ...teamB];
    // Team A shoots 65 (-7). Team B shoots 72 (E).
    const teamAGrosses = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 4]; // 65
    const teamBGrosses = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5]; // 72
    const scores = makeScores({
      "rp-a1": teamAGrosses,
      "rp-a2": teamAGrosses,
      "rp-a3": teamAGrosses,
      "rp-a4": teamAGrosses,
      "rp-b1": teamBGrosses,
      "rp-b2": teamBGrosses,
      "rp-b3": teamBGrosses,
      "rp-b4": teamBGrosses
    });
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 5000 // $50/team
        }),
        players,
        scores
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Team A wins; every A player positive, every B player negative.
    for (const id of ["rp-a1", "rp-a2", "rp-a3", "rp-a4"]) {
      expect(deltaFor(out, id)).toBeGreaterThan(0);
    }
    for (const id of ["rp-b1", "rp-b2", "rp-b3", "rp-b4"]) {
      expect(deltaFor(out, id)).toBeLessThan(0);
    }
  });
});

describe("scramble: halved scramble produces no money flow", () => {
  it("identical team totals → all players net 0", () => {
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    // Both teams shoot exactly par on every hole.
    const sameScores = [...JGCC_PARS];
    const scores = makeScores({
      "rp-a1": sameScores,
      "rp-a2": sameScores,
      "rp-b1": sameScores,
      "rp-b2": sameScores
    });
    const out = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 2000
        }),
        players,
        scores
      })
    );
    expect(sumDeltas(out)).toBe(0);
    for (const id of ["rp-a1", "rp-a2", "rp-b1", "rp-b2"]) {
      expect(deltaFor(out, id)).toBe(0);
    }
  });
});

describe("scramble: gross and net produce the same result when allowances are equal", () => {
  // Engine sanity check: with all four players at handicap 0 and net
  // allowance 100%, the gross and net scramble should produce identical
  // settlements. Catches accidental handicap leakage in the team path.
  it("zero-handicap players: net scramble == gross scramble", () => {
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", playing_handicap: 0, team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", playing_handicap: 0, team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", playing_handicap: 0, team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", playing_handicap: 0, team_id: "team-b" })
    ];
    const teamAGrosses = [4, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5]; // 67
    const teamBGrosses = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5]; // 73
    const scores = makeScores({
      "rp-a1": teamAGrosses,
      "rp-a2": teamAGrosses,
      "rp-b1": teamBGrosses,
      "rp-b2": teamBGrosses
    });

    const grossOut = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          stake_cents: 2000,
          allowance_pct: 100
        }),
        players,
        scores
      })
    );
    const netOut = settleGame(
      makeInput({
        game: makeGame({
          game_type: "scramble_net",
          stake_cents: 2000,
          allowance_pct: 100
        }),
        players,
        scores
      })
    );
    // Identical per-player deltas across both variants.
    for (const id of ["rp-a1", "rp-a2", "rp-b1", "rp-b2"]) {
      expect(deltaFor(netOut, id)).toBe(deltaFor(grossOut, id));
    }
  });
});

describe("scramble: lifetime invariant — never produces negative-total game", () => {
  it("100 deterministic seeded rounds: every settlement is zero-sum", () => {
    let s = 0xdeadbeef;
    const rng = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < 100; i++) {
      const players = [
        makePlayer({ id: `rp-${i}-a1`, name: "A1", team_id: "team-a" }),
        makePlayer({ id: `rp-${i}-a2`, name: "A2", team_id: "team-a" }),
        makePlayer({ id: `rp-${i}-b1`, name: "B1", team_id: "team-b" }),
        makePlayer({ id: `rp-${i}-b2`, name: "B2", team_id: "team-b" })
      ];
      // Random plausible scramble scores
      const aGrosses = JGCC_PARS.map((p) =>
        Math.max(2, p + (rng() < 0.3 ? -1 : rng() < 0.6 ? 0 : 1))
      );
      const bGrosses = JGCC_PARS.map((p) =>
        Math.max(2, p + (rng() < 0.3 ? -1 : rng() < 0.6 ? 0 : 1))
      );
      const scores = makeScores({
        [`rp-${i}-a1`]: aGrosses,
        [`rp-${i}-a2`]: aGrosses,
        [`rp-${i}-b1`]: bGrosses,
        [`rp-${i}-b2`]: bGrosses
      });
      const out = settleGame(
        makeInput({
          game: makeGame({
            game_type: "scramble_gross",
            stake_cents: 1000 + Math.floor(rng() * 5000)
          }),
          players,
          scores
        })
      );
      // Zero-sum every time
      expect(sumDeltas(out)).toBe(0);
    }
  });
});
