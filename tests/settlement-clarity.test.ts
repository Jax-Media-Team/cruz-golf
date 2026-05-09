import { describe, expect, it } from "vitest";
import { minimumFlow, settleGame } from "@/lib/games";
import { makeGame, makeHoles, makeInput, makePlayer, makeScores } from "./fixtures";

/**
 * "Stake means what users think it means" — regression tests for the
 * specific user-reported math confusion (e.g. "$20 wager, each player on
 * the losing team owes $17.50?").
 *
 * Every test asserts the user's intuitive expectation in plain dollars,
 * so a regression here = a betting bug.
 */

const A = "p-a", B = "p-b", C = "p-c", D = "p-d";
const COURSE = { holes: makeHoles(), par: 72 };

function team(id: string, team_id: string, hi = 0) {
  return { ...makePlayer({ id, name: id, playing_handicap: hi }), team_id };
}

function sumDeltas(out: ReturnType<typeof settleGame>) {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("stake-semantics: 2-man best ball", () => {
  it("$20 stake, 2v2, A wins → each B player owes exactly $20", () => {
    const ps = [team(A, "T1"), team(B, "T1"), team(C, "T2"), team(D, "T2")];
    // Team 1 averages 4 per hole, team 2 averages 5 per hole.
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(4), [B]: round(4), [C]: round(5), [D]: round(5) });
    const game = makeGame({ game_type: "best_ball_gross", stake_cents: 2000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(A)?.delta_cents).toBe(2000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(2000);
  });

  it("$20 stake, 4v4 (8 players), winners +$20 each / losers -$20 each", () => {
    const ps = [
      team("p-1", "T1"), team("p-2", "T1"), team("p-3", "T1"), team("p-4", "T1"),
      team("p-5", "T2"), team("p-6", "T2"), team("p-7", "T2"), team("p-8", "T2")
    ];
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({
      "p-1": round(4), "p-2": round(4), "p-3": round(4), "p-4": round(4),
      "p-5": round(5), "p-6": round(5), "p-7": round(5), "p-8": round(5)
    });
    const game = makeGame({ game_type: "best_ball_gross", stake_cents: 2000 });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    for (let i = 1; i <= 4; i++) expect(out.perPlayer.get(`p-${i}`)?.delta_cents).toBe(2000);
    for (let i = 5; i <= 8; i++) expect(out.perPlayer.get(`p-${i}`)?.delta_cents).toBe(-2000);
  });
});

describe("stake-semantics: Nassau", () => {
  it("$10/$10/$10 sweep → each loser owes $30", () => {
    const ps = [team(A, "T1"), team(B, "T1"), team(C, "T2"), team(D, "T2")];
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(4), [B]: round(4), [C]: round(5), [D]: round(5) });
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 1000,
      config: {
        match_play: false,
        front_stake_cents: 1000,
        back_stake_cents: 1000,
        overall_stake_cents: 1000
      }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-3000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-3000);
    expect(out.perPlayer.get(A)?.delta_cents).toBe(3000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(3000);
  });
});

describe("stake-semantics: 6-6-6", () => {
  it("$20 per segment, A sweeps all 3 → A wins $60, B/C/D each lose $20", () => {
    const ps = [
      makePlayer({ id: A, name: "A", playing_handicap: 0 }),
      makePlayer({ id: B, name: "B", playing_handicap: 0 }),
      makePlayer({ id: C, name: "C", playing_handicap: 0 }),
      makePlayer({ id: D, name: "D", playing_handicap: 0 })
    ];
    // A always 3, others always 4. Across all rotations, A's team wins
    // because A's score is always lower.
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(3), [B]: round(4), [C]: round(4), [D]: round(4) });
    const game = makeGame({ game_type: "six_six_six", stake_cents: 2000, config: { match_play: true } });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get(A)?.delta_cents).toBe(6000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-2000);
  });
});

describe("minimumFlow + multi-game settlement", () => {
  it("net deltas across 2 games settle to fewest transfers, zero-sum overall", () => {
    // 4 players, 2v2 best ball $20 (team 1 wins) AND pot skins $20 buyin.
    const ps = [team(A, "T1", 0), team(B, "T1", 0), team(C, "T2", 0), team(D, "T2", 0)];
    const round = (n: number) => new Array(18).fill(n);
    // Team 1 4-4-4-... wins every hole. A/B win every skin too.
    const scores = makeScores({ [A]: round(3), [B]: round(4), [C]: round(5), [D]: round(5) });

    const bestBall = settleGame(
      makeInput({
        game: makeGame({ game_type: "best_ball_gross", stake_cents: 2000 }),
        players: ps,
        scores,
        course: COURSE
      })
    );
    const skins = settleGame(
      makeInput({
        game: makeGame({
          game_type: "skins_gross",
          stake_cents: 2000,
          config: { skin_mode: "pot", buyin_cents: 2000, ties: "carry" }
        }),
        players: ps,
        scores,
        course: COURSE
      })
    );
    expect(sumDeltas(bestBall)).toBe(0);
    expect(sumDeltas(skins)).toBe(0);

    // Combine into one balance map (what the finalize page does)
    const totals = new Map<string, number>();
    for (const [pid, v] of bestBall.perPlayer) totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    for (const [pid, v] of skins.perPlayer) totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    const flows = minimumFlow(totals);

    // minimumFlow zero-sum
    let sumFlow = 0;
    for (const f of flows) sumFlow += f.amount_cents;
    // Sum of flows equals sum of negative balances
    let sumNeg = 0;
    for (const v of totals.values()) if (v < 0) sumNeg += -v;
    expect(sumFlow).toBe(sumNeg);

    // Number of transfers ≤ N - 1
    expect(flows.length).toBeLessThanOrEqual(ps.length - 1);
  });
});

describe("pot-skins cents precision", () => {
  it("3 players × $7 buy-in = $21 pot, 2 skins → $10.50 each → no fractional cent loss", () => {
    const ps = [
      makePlayer({ id: A, name: "A", playing_handicap: 0 }),
      makePlayer({ id: B, name: "B", playing_handicap: 0 }),
      makePlayer({ id: C, name: "C", playing_handicap: 0 })
    ];
    // A wins H1, B wins H2; C loses every hole.
    const par4 = new Array(18).fill(4);
    const scores = makeScores({
      [A]: [3, 4, ...par4.slice(2)],
      [B]: [4, 3, ...par4.slice(2)],
      [C]: par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 700,
      config: { skin_mode: "pot", buyin_cents: 700, ties: "carry" }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    // Pot $21, 2 skins → 1050¢ each. A wins 1: +1050 - 700 = +350. B same.
    // C: -700.
    // Distributed: 2 × 1050 = 2100. Pot = 2100. No remainder.
    expect(out.perPlayer.get(A)?.delta_cents).toBe(350);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(350);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-700);
  });

  it("4 players × $5 buy-in = $20 pot, 3 skins → $6.66 each → remainder distributed deterministically", () => {
    const ps = [A, B, C, D].map((id) => makePlayer({ id, name: id, playing_handicap: 0 }));
    const par4 = new Array(18).fill(4);
    const scores = makeScores({
      [A]: [3, 4, 4, ...par4.slice(3)],
      [B]: [4, 3, 4, ...par4.slice(3)],
      [C]: [4, 4, 3, ...par4.slice(3)],
      [D]: par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 500,
      config: { skin_mode: "pot", buyin_cents: 500, ties: "carry" }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    // Pot $20 = 2000c, 3 skins, 666c each. Distributed 1998c. Remainder 2c
    // goes to first sorted winner. Each player paid $5 = 500c buyin.
    // Each winner expected: 666 - 500 = 166c, plus 2c remainder for first winner.
    const losers = [...out.perPlayer.entries()].filter(([, v]) => v.delta_cents < 0);
    const winners = [...out.perPlayer.entries()].filter(([, v]) => v.delta_cents > 0);
    expect(winners.length).toBe(3);
    expect(losers.length).toBe(1);
    expect(losers[0][1].delta_cents).toBe(-500);
  });
});
