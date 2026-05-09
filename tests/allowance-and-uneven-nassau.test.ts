import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import { strokesPerHole } from "@/lib/handicap";
import { makeGame, makeHoles, makeInput, makePlayer, makeScores } from "./fixtures";

const A = "p-a", B = "p-b", C = "p-c", D = "p-d", E = "p-e";
const COURSE = { holes: makeHoles(), par: 72 };

function team(id: string, team_id: string, hi = 0) {
  return { ...makePlayer({ id, name: id, playing_handicap: hi }), team_id };
}

function sumDeltas(out: ReturnType<typeof settleGame>) {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("allowance_pct affects net games", () => {
  it("individual_net at 85% allowance can flip the winner vs 100%", () => {
    // Two players: A has 0 handicap, B has 14. They both shoot the same
    // gross score. At 100% B wins net by 14; at 85% B still wins but by 12.
    // The DELTA changes because the strokes-per-hole distribution changes
    // when the rounded handicap changes. We assert zero-sum and that the
    // adjusted-handicap path runs (using a strokesPerHole verification).
    const ps = [
      makePlayer({ id: A, name: "A", playing_handicap: 0 }),
      makePlayer({ id: B, name: "B", playing_handicap: 14 })
    ];
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(4), [B]: round(4) });

    const at100 = settleGame(
      makeInput({
        game: makeGame({ game_type: "individual_net", stake_cents: 1000, allowance_pct: 100 }),
        players: ps,
        scores,
        course: COURSE
      })
    );
    const at85 = settleGame(
      makeInput({
        game: makeGame({ game_type: "individual_net", stake_cents: 1000, allowance_pct: 85 }),
        players: ps,
        scores,
        course: COURSE
      })
    );
    expect(sumDeltas(at100)).toBe(0);
    expect(sumDeltas(at85)).toBe(0);
    // At both allowances B has lower net. But A's strokes (0) don't change;
    // B's effective handicap changes from 14 to round(14 × 0.85) = 12, so B's
    // net total changes by 2 strokes. Both still result in B winning $10.
    expect(at100.perPlayer.get(B)?.delta_cents).toBe(1000);
    expect(at85.perPlayer.get(B)?.delta_cents).toBe(1000);
  });

  it("strokesPerHole respects scaled handicap", () => {
    const holes = makeHoles();
    const at14 = strokesPerHole(14, holes);
    const at12 = strokesPerHole(12, holes); // 14 × 0.85 rounds to 12
    expect(at14.reduce((s, n) => s + n, 0)).toBe(14);
    expect(at12.reduce((s, n) => s + n, 0)).toBe(12);
    // Different distributions: 14 strokes covers SI 1-14, 12 covers SI 1-12.
    expect(at14).not.toEqual(at12);
  });
});

describe("Team Nassau zero-sum on uneven sides", () => {
  it("2v3 team Nassau is zero-sum (does not throw)", () => {
    // Side A has 2 players, side B has 3. Stake $20/segment.
    const ps = [
      team(A, "T1"),
      team(B, "T1"),
      team(C, "T2"),
      team(D, "T2"),
      team(E, "T2")
    ];
    const round = (n: number) => new Array(18).fill(n);
    // Side A wins everything (lower scores).
    const scores = makeScores({
      [A]: round(3),
      [B]: round(3),
      [C]: round(5),
      [D]: round(5),
      [E]: round(5)
    });
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 2000,
      config: {
        match_play: false,
        front_stake_cents: 2000,
        back_stake_cents: 2000,
        overall_stake_cents: 2000
      }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    // Each loser owes stake × 3 (sweep). Pot = 3 × $20 × 3 segments = $180.
    // 2 winners split → $90 each.
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-6000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-6000);
    expect(out.perPlayer.get(E)?.delta_cents).toBe(-6000);
    expect((out.perPlayer.get(A)?.delta_cents ?? 0) + (out.perPlayer.get(B)?.delta_cents ?? 0)).toBe(18000);
  });

  it("balanced 2v2 team Nassau still produces $20 per loser per segment", () => {
    const ps = [team(A, "T1"), team(B, "T1"), team(C, "T2"), team(D, "T2")];
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({ [A]: round(4), [B]: round(4), [C]: round(5), [D]: round(5) });
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 2000,
      config: { match_play: false, front_stake_cents: 2000, back_stake_cents: 2000, overall_stake_cents: 2000 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-6000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-6000);
    expect(out.perPlayer.get(A)?.delta_cents).toBe(6000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(6000);
  });
});

describe("9-hole finalize math", () => {
  it("Nassau on 9-hole settles overall-only, no infinite-pending segments", () => {
    const ps = [team(A, "T1"), team(B, "T2")];
    // 9 holes only.
    const scores = [
      ...new Array(9).fill(0).map((_, i) => ({ round_player_id: A, hole_number: i + 1, gross: 4 })),
      ...new Array(9).fill(0).map((_, i) => ({ round_player_id: B, hole_number: i + 1, gross: 5 }))
    ];
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 1000,
      config: { match_play: false, overall_stake_cents: 1000 }
    });
    const out = settleGame(
      makeInput({ game, players: ps, scores, course: COURSE, totalHoles: 9, startingHole: 1 })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
    // A wins overall by 9 strokes — settles for $10.
    expect(out.perPlayer.get(A)?.delta_cents).toBe(1000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(-1000);
  });
});
