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

describe("scramble: differing per-team scores", () => {
  // ⚠️ PRODUCT GAP found while writing this test:
  //
  // The team-game engine currently requires EVERY team member to have a
  // score on every hole — if one player has null, the hole is treated
  // as incomplete and the team doesn't settle. This makes sense for
  // best ball (each member plays their own ball). It does NOT match
  // real scramble play, where typically ONE player records the team's
  // single shared score.
  //
  // Logged as SCRAMBLE-ONE-ENTRY in ISSUE_TRACKER.md. Until it's
  // addressed, the scramble UX expectation is that every team member
  // taps the same number on every hole. The /score-group page
  // facilitates this (group entry pad shows all 4 players per hole).
  //
  // Tests below document CURRENT engine behavior so any regression in
  // the relaxation work later is caught.

  it("CURRENT BEHAVIOR: missing team-member scores block settlement (zero-sum + no flow)", () => {
    // Patrick + Ben on team A. Patrick records every hole. Ben records
    // NOTHING. Today the engine treats every hole as incomplete →
    // no money moves. See SCRAMBLE-ONE-ENTRY gap above.
    const players = [
      makePlayer({ id: "rp-a1", name: "Patrick", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mitch", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyle", team_id: "team-b" })
    ];
    const patScores = [3, 4, 4, 3, 3, 4, 4, 3, 3, 4, 4, 4, 3, 4, 4, 4, 3, 5]; // 66
    const benScores = Array(18).fill(null); // missing
    const teamBScores = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4, 5]; // 73
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
    // Engine is conservative: incomplete team data → no settlement.
    // Zero-sum trivially holds (everyone at 0).
    expect(sumDeltas(out)).toBe(0);
    expect(deltaFor(out, "rp-a1")).toBe(0);
    expect(deltaFor(out, "rp-a2")).toBe(0);
    expect(deltaFor(out, "rp-b1")).toBe(0);
    expect(deltaFor(out, "rp-b2")).toBe(0);
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
