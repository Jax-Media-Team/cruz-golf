import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import { makeGame, makeHoles, makeInput, makePlayer, makeScores } from "./fixtures";

/**
 * Regression tests for the "missing middle hole locks out later holes" bug
 * and the "un-scored players steal the lead in stroke play" bug. These tests
 * codify the partial-hole behavior: every engine must continue evaluating
 * later complete holes when a middle hole is missing, and stroke-play
 * projection must not award money to players who haven't played.
 */

const A = "p-a", B = "p-b", C = "p-c", D = "p-d";
const COURSE = { holes: makeHoles(), par: 72 };

function players() {
  return [
    makePlayer({ id: A, name: "Alice", playing_handicap: 8 }),
    makePlayer({ id: B, name: "Bob", playing_handicap: 14 }),
    makePlayer({ id: C, name: "Carl", playing_handicap: 22 }),
    makePlayer({ id: D, name: "Dee", playing_handicap: 0 })
  ];
}

function sumDeltas(out: ReturnType<typeof settleGame>) {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("skins partial-hole handling", () => {
  it("awards skins on holes 5-9 when hole 4 has a missing score", () => {
    const ps = players();
    // A wins H1, no skin H2-3 (ties), H4 missing for D, A wins H5, ...
    const scores = makeScores({
      [A]: [3, 4, 4, 4, 3, 4, 4, 4, 4],
      [B]: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      [C]: [5, 4, 4, 4, 5, 5, 5, 5, 5],
      [D]: [5, 4, 4, NaN as any, 5, 5, 5, 5, 5] // gap on hole 4
    });
    // Strip the NaN entry so it represents a missing score, not a NaN.
    const cleaned = scores.filter((s) => !Number.isNaN(s.gross));

    const game = makeGame({ game_type: "skins_gross", stake_cents: 0, config: { net: false, skin_value_cents: 100, ties: "carry", escalation: "linear" } });
    const out = settleGame(makeInput({ game, players: ps, scores: cleaned, course: COURSE }));

    // A should have won at least one skin on H1 and H5+ (excluding H4).
    const aDelta = out.perPlayer.get(A)?.delta_cents ?? 0;
    expect(aDelta).toBeGreaterThan(0);
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live"); // not all 18 played
  });

  it("returns zero deltas when nothing is scored", () => {
    const game = makeGame({ game_type: "skins_gross", stake_cents: 0, config: { skin_value_cents: 100 } });
    const out = settleGame(makeInput({ game, players: players(), scores: [], course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.highlights).toEqual([]);
    expect(out.status).toBe("live");
  });

  it("returns zero deltas when only hole 1 is partially entered (one player only)", () => {
    const partial = makeScores({ [A]: [3] });
    const game = makeGame({ game_type: "skins_gross", stake_cents: 0, config: { skin_value_cents: 100 } });
    const out = settleGame(makeInput({ game, players: players(), scores: partial, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.highlights).toEqual([]);
  });
});

describe("team game partial-hole handling", () => {
  it("best-ball net: gap at hole 4 still credits later complete holes", () => {
    const T1 = "team-1", T2 = "team-2";
    const ps = players().map((p, i) => ({ ...p, team_id: i < 2 ? T1 : T2 }));
    // Holes 1-9 scored except hole 4 for player C.
    const scores = makeScores({
      [A]: [4, 4, 4, 4, 3, 4, 4, 4, 4],
      [B]: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      [C]: [5, 5, 5, 0, 5, 5, 5, 5, 5], // hole 4 = 0 means absent — we strip
      [D]: [5, 5, 5, 5, 5, 5, 5, 5, 5]
    }).filter((s) => !(s.round_player_id === C && s.hole_number === 4));

    const game = makeGame({ game_type: "best_ball_net", stake_cents: 500 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live");
  });

  it("aggregate gross with no scores yields zero across all players, no NaN", () => {
    const T1 = "team-1", T2 = "team-2";
    const ps = players().map((p, i) => ({ ...p, team_id: i < 2 ? T1 : T2 }));
    const game = makeGame({ game_type: "aggregate_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores: [], course: COURSE }));
    for (const v of out.perPlayer.values()) {
      expect(Number.isFinite(v.delta_cents)).toBe(true);
      expect(v.delta_cents).toBe(0);
    }
  });
});

describe("nassau partial-hole handling", () => {
  it("front 9 settles when complete; back 9 with gap stays live", () => {
    const ps = players().slice(0, 2); // 2-player Nassau
    // Front 9 fully scored, back 9 has hole 13 missing for B.
    const scores = makeScores({
      [A]: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
      [B]: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5]
    }).filter((s) => !(s.round_player_id === B && s.hole_number === 13));
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 1000,
      config: { match_play: true, front_stake_cents: 1000, back_stake_cents: 1000, overall_stake_cents: 1000 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live");
    // A clearly won front 9 → A's delta must be positive, B negative.
    expect((out.perPlayer.get(A)?.delta_cents ?? 0)).toBeGreaterThan(0);
    expect((out.perPlayer.get(B)?.delta_cents ?? 0)).toBeLessThan(0);
  });
});

describe("individual stroke play projection", () => {
  it("does not award money when only some players have started", () => {
    const ps = players();
    // Only Alice has scored hole 1.
    const scores = makeScores({ [A]: [3] });
    const game = makeGame({ game_type: "individual_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    for (const v of out.perPlayer.values()) {
      // No one moves money until everyone is on the same hole.
      expect(v.delta_cents).toBe(0);
    }
    expect(out.status).toBe("live");
  });

  it("projects winner once everyone is on the same hole", () => {
    const ps = players();
    // Everyone has scored exactly hole 1. Alice 3 (best), Bob 4, Carl 5, Dee 4.
    const scores = makeScores({ [A]: [3], [B]: [4], [C]: [5], [D]: [4] });
    const game = makeGame({ game_type: "individual_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    const aDelta = out.perPlayer.get(A)?.delta_cents ?? 0;
    expect(aDelta).toBeGreaterThan(0); // Alice is leading
    expect(out.status).toBe("live");
  });

  it("zero-sum holds with full course played", () => {
    const ps = players();
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(4), [B]: round(5), [C]: round(5), [D]: round(5) });
    const game = makeGame({ game_type: "individual_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
  });
});

describe("six-six-six partial segment", () => {
  it("segment 2 settles independently when segment 1 has a gap", () => {
    const ps = players().slice(0, 4);
    // 666 needs exactly 4 players. Segment 1 = holes 1-6 (AB vs CD).
    // Segment 2 = holes 7-12 (AC vs BD). Make seg 1 incomplete (hole 3 missing for B),
    // seg 2 fully scored.
    const A_scores = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]; // 12 holes
    const B_scores = [5, 5, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const C_scores = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const D_scores = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
    const scores = makeScores({ [A]: A_scores, [B]: B_scores, [C]: C_scores, [D]: D_scores })
      .filter((s) => !(s.round_player_id === B && s.hole_number === 3));
    const game = makeGame({
      game_type: "six_six_six",
      stake_cents: 1000,
      config: { match_play: true }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live");
  });
});
