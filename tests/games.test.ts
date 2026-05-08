import { describe, expect, it } from "vitest";
import { settleGame, minimumFlow } from "@/lib/games";
import { makeGame, makeInput, makePlayer, makeScores } from "./fixtures";

function sumDeltas(out: ReturnType<typeof settleGame>): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("individual stroke play", () => {
  it("3 players, stake 1000 cents — winner gets 2000, others lose 1000", () => {
    const players = [
      makePlayer({ id: "A", name: "Alice", playing_handicap: 0 }),
      makePlayer({ id: "B", name: "Bob", playing_handicap: 0 }),
      makePlayer({ id: "C", name: "Cara", playing_handicap: 0 })
    ];
    const scores = makeScores({
      A: new Array(18).fill(4),
      B: new Array(18).fill(5),
      C: new Array(18).fill(5)
    });
    const out = settleGame(
      makeInput({
        players,
        scores,
        game: makeGame({ game_type: "individual_gross", stake_cents: 1000 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(2000);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(-1000);
  });

  it("ties split evenly", () => {
    const players = [
      makePlayer({ id: "A", name: "A" }),
      makePlayer({ id: "B", name: "B" }),
      makePlayer({ id: "C", name: "C" }),
      makePlayer({ id: "D", name: "D" })
    ];
    const scores = makeScores({
      A: new Array(18).fill(4),
      B: new Array(18).fill(4),
      C: new Array(18).fill(5),
      D: new Array(18).fill(5)
    });
    const out = settleGame(
      makeInput({
        players,
        scores,
        game: makeGame({ game_type: "individual_gross", stake_cents: 1000 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(1000);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(1000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(-1000);
  });
});

describe("skins", () => {
  it("gross skins zero-sum and awards to outright low scores", () => {
    const players = [
      makePlayer({ id: "A", name: "A" }),
      makePlayer({ id: "B", name: "B" }),
      makePlayer({ id: "C", name: "C" })
    ];
    // A wins hole 1 outright (3 vs 4 vs 4); rest pushed.
    const scoresA = new Array(18).fill(4);
    scoresA[0] = 3;
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({
          A: scoresA,
          B: new Array(18).fill(4),
          C: new Array(18).fill(4)
        }),
        game: makeGame({ game_type: "skins_gross", stake_cents: 1800, config: { skin_value_cents: 100 } })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // A wins one skin (100c) from B and C (50c each).
    expect(out.perPlayer.get("A")!.delta_cents).toBe(100);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-50);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(-50);
  });

  it("default tie behavior is split, not carry", () => {
    const players = [makePlayer({ id: "A", name: "A" }), makePlayer({ id: "B", name: "B" })];
    // Hole 1 push (4-4), hole 2 A wins 3-4. With default ties=split, hole 1
    // value should split between the two tied players (so net change there is
    // zero) and hole 2 is worth one base skin to A.
    const a = new Array(18).fill(4);
    a[1] = 3;
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: a, B: new Array(18).fill(4) }),
        game: makeGame({
          game_type: "skins_gross",
          stake_cents: 0,
          config: { skin_value_cents: 100 }
        })
      })
    );
    expect(out.perPlayer.get("A")!.delta_cents).toBe(100);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-100);
    expect(sumDeltas(out)).toBe(0);
  });

  it("explicit ties=carry stacks linearly when configured", () => {
    const players = [
      makePlayer({ id: "A", name: "A" }),
      makePlayer({ id: "B", name: "B" })
    ];
    const a = new Array(18).fill(4);
    a[1] = 3;
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: a, B: new Array(18).fill(4) }),
        game: makeGame({
          game_type: "skins_gross",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
        })
      })
    );
    // Hole 1 carries (push), hole 2 A wins worth 200 (linear).
    expect(out.perPlayer.get("A")!.delta_cents).toBe(200);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-200);
    expect(sumDeltas(out)).toBe(0);
  });

  it("canadian skins requires a birdie", () => {
    const players = [makePlayer({ id: "A", name: "A" }), makePlayer({ id: "B", name: "B" })];
    // Par-4 holes throughout. A shoots 4 vs B's 5 — no birdie, no skin.
    const a = new Array(18).fill(4);
    const b = new Array(18).fill(5);
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: a, B: b }),
        game: makeGame({
          game_type: "skins_canadian",
          stake_cents: 0,
          config: { skin_value_cents: 100 }
        })
      })
    );
    expect(out.perPlayer.get("A")!.delta_cents).toBe(0);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(0);
  });
});

describe("team game (best ball net)", () => {
  it("zero sum, lower team total wins, per-player stake", () => {
    const players = [
      makePlayer({ id: "A", name: "A", team_id: "T1" }),
      makePlayer({ id: "B", name: "B", team_id: "T1" }),
      makePlayer({ id: "C", name: "C", team_id: "T2" }),
      makePlayer({ id: "D", name: "D", team_id: "T2" })
    ];
    const scores = makeScores({
      A: new Array(18).fill(4),
      B: new Array(18).fill(5),
      C: new Array(18).fill(5),
      D: new Array(18).fill(5)
    });
    const out = settleGame(
      makeInput({
        players,
        scores,
        game: makeGame({ game_type: "best_ball_net", stake_cents: 1000 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(1000);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(1000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(-1000);
  });
});

describe("nassau", () => {
  it("front+back+overall settle correctly when all three go to same side", () => {
    const players = [makePlayer({ id: "A", name: "A" }), makePlayer({ id: "B", name: "B" })];
    // A wins every hole.
    const a = new Array(18).fill(3);
    const b = new Array(18).fill(4);
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: a, B: b }),
        game: makeGame({
          game_type: "nassau",
          stake_cents: 500,
          config: { match_play: true, front_stake_cents: 500, back_stake_cents: 500, overall_stake_cents: 500 }
        })
      })
    );
    // A wins 3 segments × 500 = 1500 from B.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(1500);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-1500);
  });

  it("pushed segment moves no money", () => {
    const players = [makePlayer({ id: "A", name: "A" }), makePlayer({ id: "B", name: "B" })];
    // Identical scores everywhere -> all three segments push.
    const s = new Array(18).fill(4);
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: s, B: s }),
        game: makeGame({
          game_type: "nassau",
          stake_cents: 500,
          config: { match_play: true, front_stake_cents: 500, back_stake_cents: 500, overall_stake_cents: 500 }
        })
      })
    );
    expect(out.perPlayer.get("A")!.delta_cents).toBe(0);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(0);
  });
});

describe("6-6-6 partner rotation", () => {
  it("zero sum across three rotated 6-hole segments", () => {
    const players = [
      makePlayer({ id: "A", name: "A" }),
      makePlayer({ id: "B", name: "B" }),
      makePlayer({ id: "C", name: "C" }),
      makePlayer({ id: "D", name: "D" })
    ];
    // Make A & C dominant individuals: each shoots 4, others shoot 5.
    // Segment 1 (AB vs CD): best ball is min(A,B)=4 vs min(C,D)=4 -> push every hole.
    // Segment 2 (AC vs BD): best ball is 4 vs 5 -> AC wins each hole, segment to AC.
    // Segment 3 (AD vs BC): best ball is 4 vs 4 -> push.
    const a = new Array(18).fill(4);
    const b = new Array(18).fill(5);
    const c = new Array(18).fill(4);
    const d = new Array(18).fill(5);
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({ game_type: "six_six_six", stake_cents: 500 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(500);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(500);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(-500);
  });

  it("does nothing when fewer than 4 players", () => {
    const players = [
      makePlayer({ id: "A", name: "A" }),
      makePlayer({ id: "B", name: "B" }),
      makePlayer({ id: "C", name: "C" })
    ];
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores({ A: new Array(18).fill(4), B: new Array(18).fill(4), C: new Array(18).fill(4) }),
        game: makeGame({ game_type: "six_six_six", stake_cents: 500 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
  });
});

describe("minimumFlow settlement", () => {
  it("collapses to two transfers for 4-player rounds", () => {
    const balances = new Map([
      ["A", 1500],
      ["B", 500],
      ["C", -800],
      ["D", -1200]
    ]);
    const flows = minimumFlow(balances);
    // Sum invariant: every balance reaches zero.
    const out = new Map(balances);
    for (const f of flows) {
      out.set(f.from, (out.get(f.from) ?? 0) + f.amount_cents);
      out.set(f.to, (out.get(f.to) ?? 0) - f.amount_cents);
    }
    for (const v of out.values()) expect(v).toBe(0);
  });
});
