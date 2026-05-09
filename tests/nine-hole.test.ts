import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import { makeGame, makeHoles, makeInput, makePlayer, makeScores } from "./fixtures";

/**
 * 9-hole rounds and shotgun starts (startingHole != 1) are first-class
 * — every engine should iterate over only the holes-in-play, not the full
 * 18-hole course list.
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

function sumDeltas(out: ReturnType<typeof settleGame>): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("9-hole rounds — front 9", () => {
  it("individual gross marks final after 9 scores per player", () => {
    const ps = players();
    // Everyone played holes 1-9 only. D has the lowest gross at 35.
    const scores = makeScores({
      [A]: [4, 4, 5, 3, 4, 4, 3, 4, 5], // 36
      [B]: [5, 5, 6, 4, 5, 5, 4, 5, 6], // 45
      [C]: [5, 6, 5, 4, 5, 5, 4, 5, 6], // 45
      [D]: [4, 4, 4, 3, 4, 4, 3, 4, 5]  // 35
    });
    const game = makeGame({ game_type: "individual_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
    // D (lowest gross) wins.
    expect((out.perPlayer.get(D)?.delta_cents ?? 0)).toBeGreaterThan(0);
  });

  it("skins gross awards on holes 1-9, never waits for hole 10+", () => {
    const ps = players();
    // Alice wins hole 1 outright.
    const scores = makeScores({
      [A]: [3, 4, 5, 4, 4, 4, 3, 4, 5],
      [B]: [4, 4, 5, 4, 4, 4, 4, 4, 5],
      [C]: [5, 4, 5, 4, 4, 4, 4, 4, 5],
      [D]: [4, 4, 5, 4, 4, 4, 4, 4, 5]
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 0,
      config: { skin_value_cents: 100, ties: "carry" }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 }));
    expect(sumDeltas(out)).toBe(0);
    // Alice's hole-1 birdie = 1 skin. Engine should NOT be stuck waiting on hole 10+.
    expect((out.perPlayer.get(A)?.delta_cents ?? 0)).toBeGreaterThan(0);
    // Status is final because every hole-in-play (1..9) is scored and no carry remains.
    expect(out.status).toBe("final");
  });

  it("Nassau on a 9-hole round settles as a single overall segment", () => {
    const ps = players().slice(0, 2);
    // Alice clearly wins the front 9 in stroke play.
    const scores = makeScores({
      [A]: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      [B]: [5, 5, 5, 5, 5, 5, 5, 5, 5]
    });
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 1000,
      config: {
        match_play: false,
        front_stake_cents: 1000,
        back_stake_cents: 1000,
        overall_stake_cents: 2000
      }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
    // Alice should net the overall_stake_cents only (no front + back + overall).
    expect(out.perPlayer.get(A)?.delta_cents).toBe(2000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(-2000);
  });

  it("best ball net on a 9-hole round is zero-sum and final", () => {
    const T1 = "team-1", T2 = "team-2";
    const ps = players().map((p, i) => ({ ...p, team_id: i < 2 ? T1 : T2 }));
    const scores = makeScores({
      [A]: [4, 4, 5, 3, 4, 4, 3, 4, 5],
      [B]: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      [C]: [5, 5, 5, 5, 5, 5, 5, 5, 5],
      [D]: [5, 5, 5, 5, 5, 5, 5, 5, 5]
    });
    const game = makeGame({ game_type: "best_ball_net", stake_cents: 500 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
  });
});

describe("9-hole rounds — back 9 (startingHole = 10)", () => {
  it("settles using only holes 10-18", () => {
    const ps = players();
    // Score holes 10-18 only. makeScores indexes by position, so we craft
    // explicit hole numbers.
    const scoresFor = (rp: string, byHole: number[]): { round_player_id: string; hole_number: number; gross: number }[] =>
      byHole.map((g, i) => ({ round_player_id: rp, hole_number: 10 + i, gross: g }));
    const scores = [
      ...scoresFor(A, [4, 4, 5, 3, 4, 4, 3, 4, 5]),
      ...scoresFor(B, [4, 4, 4, 4, 4, 4, 4, 4, 4]),
      ...scoresFor(C, [5, 5, 5, 5, 5, 5, 5, 5, 5]),
      ...scoresFor(D, [4, 4, 4, 4, 4, 4, 4, 4, 4])
    ];
    const game = makeGame({ game_type: "individual_gross", stake_cents: 1000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 10 }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
    expect((out.perPlayer.get(A)?.delta_cents ?? 0)).toBeGreaterThan(0);
  });
});

describe("6-6-6 on 9-hole round", () => {
  it("returns no settlement (needs full 18) without crashing", () => {
    const ps = players();
    const scores = makeScores({
      [A]: [4, 4, 5, 3, 4, 4, 3, 4, 5],
      [B]: [5, 5, 5, 4, 5, 5, 4, 5, 6],
      [C]: [5, 5, 5, 4, 5, 5, 4, 5, 6],
      [D]: [4, 4, 4, 3, 4, 4, 3, 4, 5]
    });
    const game = makeGame({
      game_type: "six_six_six",
      stake_cents: 1000,
      config: { match_play: true }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 }));
    expect(sumDeltas(out)).toBe(0);
    // Engine should not crash — it just produces zero deltas.
    for (const v of out.perPlayer.values()) expect(v.delta_cents).toBe(0);
  });
});
