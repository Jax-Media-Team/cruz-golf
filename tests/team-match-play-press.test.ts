import { describe, it, expect } from "vitest";
import { settleGame } from "@/lib/games";
import {
  makeGame,
  makeHoles,
  makePlayer,
  makeScores
} from "./fixtures";
import type { GameInput } from "@/lib/types";

/**
 * Best Ball + Aggregate match-play + auto-presses regression suite.
 *
 * Engine: lib/games/team.ts settleTeamGame.
 * Press primitive: lib/games/press.ts (already covered by tests/press.test.ts).
 *
 * Tests focus on:
 *  1. Stroke play stays the default (no behavior change for legacy callers)
 *  2. Match-play settlement awards the stake to the lower-hole-count team
 *  3. Match-play with 3+ teams falls back to stroke play
 *  4. Auto-presses fire ONLY when match_play=true AND presses='auto_2_down'
 *  5. Press money is zero-sum across the four players
 */

function bestBallMatch(opts: {
  matchPlay: boolean;
  presses?: "none" | "auto_2_down";
  scoresAB: number[];
  scoresCD: number[];
}): GameInput {
  // 4 players in 2 teams of 2. Holes default par-4. AB on team-A, CD on team-B.
  const a = makePlayer({ id: "rp-a", name: "A", team_id: "team-A" });
  const b = makePlayer({ id: "rp-b", name: "B", team_id: "team-A" });
  const c = makePlayer({ id: "rp-c", name: "C", team_id: "team-B" });
  const d = makePlayer({ id: "rp-d", name: "D", team_id: "team-B" });
  const holes = makeHoles();
  const scoresMap: Record<string, number[]> = {
    "rp-a": opts.scoresAB,
    "rp-b": opts.scoresAB,
    "rp-c": opts.scoresCD,
    "rp-d": opts.scoresCD
  };
  return {
    course: { holes, par: 72 },
    players: [a, b, c, d],
    scores: makeScores(scoresMap),
    game: makeGame({
      game_type: "best_ball_gross",
      stake_cents: 1000,
      allowance_pct: 100,
      config: {
        match_play: opts.matchPlay,
        presses: opts.presses ?? "none"
      }
    })
  };
}

describe("Best Ball stroke play (default behavior unchanged)", () => {
  it("awards the lower-total team the per-player stake", () => {
    // A scores 4 every hole = 72, C scores 5 every hole = 90.
    // Stroke: team-A wins. Each loser pays $10. Pot $20 splits between A,B → $10 each.
    const out = settleGame(
      bestBallMatch({
        matchPlay: false,
        scoresAB: new Array(18).fill(4),
        scoresCD: new Array(18).fill(5)
      })
    );
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-b")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("rp-d")?.delta_cents).toBe(-1000);
  });

  it("returns zero on a tied round (stroke)", () => {
    const out = settleGame(
      bestBallMatch({
        matchPlay: false,
        scoresAB: new Array(18).fill(4),
        scoresCD: new Array(18).fill(4)
      })
    );
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(0);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(0);
  });
});

describe("Best Ball match play", () => {
  it("awards the more-holes-won team the stake", () => {
    // A = 3,3,3 then 4,4,...,4 (3 hole wins, 15 ties)
    // C = 4,4,4 then 4,4,...,4
    const aScores = [3, 3, 3, ...new Array(15).fill(4)];
    const cScores = new Array(18).fill(4);
    const out = settleGame(
      bestBallMatch({
        matchPlay: true,
        scoresAB: aScores,
        scoresCD: cScores
      })
    );
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-b")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("rp-d")?.delta_cents).toBe(-1000);
  });

  it("returns zero on a halved match (equal hole wins)", () => {
    // A wins 3 holes, C wins 3 holes, the rest tied → match halved.
    const aScores = [3, 3, 3, 5, 5, 5, ...new Array(12).fill(4)];
    const cScores = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const out = settleGame(
      bestBallMatch({
        matchPlay: true,
        scoresAB: aScores,
        scoresCD: cScores
      })
    );
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(0);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(0);
  });

  it("zero-sum: total deltas across all 4 players sum to 0", () => {
    const out = settleGame(
      bestBallMatch({
        matchPlay: true,
        scoresAB: [3, 3, 3, ...new Array(15).fill(4)],
        scoresCD: new Array(18).fill(4)
      })
    );
    const total = ["rp-a", "rp-b", "rp-c", "rp-d"]
      .map((id) => out.perPlayer.get(id)?.delta_cents ?? 0)
      .reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });
});

describe("Best Ball match play + auto presses", () => {
  it("fires presses when one team is 2 down with 3+ holes left", () => {
    // A wins holes 1 and 2 → match goes +2 for team-A → press opens
    // covering holes 3-18. A keeps winning every hole → press is +16 for A.
    // Match: A wins 18-0 → match settles for A.
    // Press 1: A wins 16 holes from press-open → +$10 from C+D (1v1 partner split).
    const aScores = new Array(18).fill(3);
    const cScores = new Array(18).fill(5);
    const out = settleGame(
      bestBallMatch({
        matchPlay: true,
        presses: "auto_2_down",
        scoresAB: aScores,
        scoresCD: cScores
      })
    );
    // Match stake $10 + 1 press at $10 = $20 / loser
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBeGreaterThanOrEqual(2000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-2000);
    // Zero-sum
    const total = ["rp-a", "rp-b", "rp-c", "rp-d"]
      .map((id) => out.perPlayer.get(id)?.delta_cents ?? 0)
      .reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it("does NOT fire presses when match_play=false (presses are match-only)", () => {
    // Same trigger pattern, but stroke-play. Should equal a single
    // stroke-play settlement, no press money.
    const out = settleGame(
      bestBallMatch({
        matchPlay: false,
        presses: "auto_2_down", // ignored when match_play=false
        scoresAB: new Array(18).fill(3),
        scoresCD: new Array(18).fill(5)
      })
    );
    // Stroke: team-A wins. Just the base $10 stake — no press.
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-1000);
  });

  it("does NOT fire presses when presses='none' even in match play", () => {
    const out = settleGame(
      bestBallMatch({
        matchPlay: true,
        presses: "none",
        scoresAB: new Array(18).fill(3),
        scoresCD: new Array(18).fill(5)
      })
    );
    // Match-play wins by a wide margin → just the $10 match stake.
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(1000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-1000);
  });
});

describe("Best Ball match play with 3+ teams falls back to stroke play", () => {
  it("ignores match_play=true with 3 teams; uses cumulative-total settlement", () => {
    const a = makePlayer({ id: "rp-a", name: "A", team_id: "team-A" });
    const b = makePlayer({ id: "rp-b", name: "B", team_id: "team-A" });
    const c = makePlayer({ id: "rp-c", name: "C", team_id: "team-B" });
    const d = makePlayer({ id: "rp-d", name: "D", team_id: "team-B" });
    const e = makePlayer({ id: "rp-e", name: "E", team_id: "team-C" });
    const f = makePlayer({ id: "rp-f", name: "F", team_id: "team-C" });
    const holes = makeHoles();
    const input: GameInput = {
      course: { holes, par: 72 },
      players: [a, b, c, d, e, f],
      scores: makeScores({
        "rp-a": new Array(18).fill(3),
        "rp-b": new Array(18).fill(3),
        "rp-c": new Array(18).fill(4),
        "rp-d": new Array(18).fill(4),
        "rp-e": new Array(18).fill(5),
        "rp-f": new Array(18).fill(5)
      }),
      game: makeGame({
        game_type: "best_ball_gross",
        stake_cents: 1000,
        config: { match_play: true, presses: "auto_2_down" }
      })
    };
    const out = settleGame(input);
    // Stroke fallback: lowest-total wins. team-A wins, gets pot from B + C.
    // 4 losers × $10 = $40 pot, split among 2 winners = $20 each.
    expect(out.perPlayer.get("rp-a")?.delta_cents).toBe(2000);
    expect(out.perPlayer.get("rp-b")?.delta_cents).toBe(2000);
    expect(out.perPlayer.get("rp-c")?.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("rp-d")?.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("rp-e")?.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("rp-f")?.delta_cents).toBe(-1000);
  });
});
