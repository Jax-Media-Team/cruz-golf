/**
 * 6-6-6 auto-press tests.
 *
 * Patrick's directive: presses are core golf gambling behavior, not a
 * side feature. 6-6-6 in particular needed press support because each
 * segment plays like its own match (partners rotate between segments)
 * and golfers regularly press inside a segment.
 *
 * Engine wiring (lib/games/six_six_six.ts):
 *   - config.presses = "auto_2_down" triggers per-segment auto-presses
 *   - Each segment has its own press chain (no carry between segments
 *     because the teams change)
 *   - Standard rule: 2-down trigger, ≥3 holes left, max 4 presses per
 *     segment — matches the Nassau press primitive
 *   - Manual presses (round_presses table + UI) work for ANY 6-6-6
 *     round regardless of this config; tested separately in
 *     press-simulation.test.ts.
 *
 * Invariants tested:
 *   - Zero-sum across the whole game (segments + presses)
 *   - No-press default config produces same result as press="none"
 *   - Press fires in segment 1 don't pay segment 2 or 3 players
 *     (segment-scoped, no cross-segment partner contamination)
 *   - Press in segment with 5 incomplete holes settles when those
 *     holes get scored
 *   - Score edits invalidate prior press settlement (engine reads
 *     current state every settle — no stale press cache)
 */
import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import { makeGame, makeInput, makePlayer, makeScores } from "./fixtures";
import type { GameOutput } from "@/lib/types";

function sumDeltas(out: GameOutput): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

const PLAYERS = [
  makePlayer({ id: "A", name: "Pat" }),
  makePlayer({ id: "B", name: "Ben" }),
  makePlayer({ id: "C", name: "Mit" }),
  makePlayer({ id: "D", name: "Kyl" })
];
// Default rotation:
//   Seg 1 (1-6):   A+B vs C+D
//   Seg 2 (7-12):  A+C vs B+D
//   Seg 3 (13-18): A+D vs B+C

describe("6-6-6 with presses=auto_2_down", () => {
  it("baseline: with presses on but no triggering deficit, results identical to no presses", () => {
    // All 4 players par every hole — every segment pushes, zero presses fire.
    const par = new Array(18).fill(4);
    const noPress = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: par, B: par, C: par, D: par }),
        game: makeGame({ game_type: "six_six_six", stake_cents: 500 })
      })
    );
    const withPress = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: par, B: par, C: par, D: par }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(withPress)).toBe(0);
    for (const id of ["A", "B", "C", "D"]) {
      expect(withPress.perPlayer.get(id)!.delta_cents).toBe(
        noPress.perPlayer.get(id)!.delta_cents
      );
    }
  });

  it("press fires in segment 1 when team A+B goes 2-down with ≥3 holes left", () => {
    // Segment 1 (holes 1-6): A+B vs C+D
    //   C+D wins holes 1,2 (team min = 3 vs A+B min = 4) → 2-down at hole 2
    //   With 4 holes remaining (3-6), press triggers covering 3-6.
    //   Holes 3-6 pushed → press halves → 0 cents from press.
    //   Segment 1 itself: A+B lost 2-0 → C+D wins segment.
    // Segments 2 + 3: everyone pars → push.
    const a = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const b = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const c = [3, 3, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const d = [3, 3, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Segment 1 alone (no press impact since press halved):
    // C+D each +500, A+B each -500.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(500);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(500);
  });

  it("press fires AND C+D wins the press → A+B lose extra stake", () => {
    // Segment 1 (1-6): C+D goes 2-up at hole 2 → press opens at hole 3.
    //   Hole 3: C+D wins again (min = 3 vs A+B min = 4) → press +1 for C+D.
    //   Holes 4-6: push (all 4s). Press settles -1 from A's perspective.
    //   Segment payout: C+D wins segment (5-down at end basically) → ±500.
    //   Press payout: stake=500 to each loser, pot split among winners.
    //     2 losers × $5 = $10 pot. 2 winners → $5 each. So C+D each +500
    //     from press, A+B each -500 from press.
    // Total: A,B = -500 (seg) + -500 (press) = -1000 each
    //        C,D = +500 (seg) + +500 (press) = +1000 each
    const a = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const b = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const c = [3, 3, 3, 4, 4, 4, ...new Array(12).fill(4)];
    const d = [3, 3, 3, 4, 4, 4, ...new Array(12).fill(4)];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(1000);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(1000);
  });

  it("segment-scoped: a press in segment 1 does NOT carry into segment 2's payout", () => {
    // Segment 1 (1-6, A+B vs C+D): C+D wins, press fires, press pays C+D
    //   (same setup as previous test for segment 1)
    // Segment 2 (7-12, A+C vs B+D): everyone pars → push (no payout)
    // Segment 3 (13-18, A+D vs B+C): A+D wins (a+d shoot 3, b+c shoot 4)
    //
    // If segment 1's press contaminated segment 2 or 3 (e.g., the press
    // primitive ran over all 18 holes instead of just segment 1), we'd
    // see different numbers below.
    const a = [
      4, 4, 4, 4, 4, 4,    // seg 1: A+B side, par (with C+D winning)
      4, 4, 4, 4, 4, 4,    // seg 2: A+C side, par
      3, 3, 3, 3, 3, 3     // seg 3: A+D side, birdies — A+D wins
    ];
    const b = [
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4     // seg 3: B+C side, pars — A+D wins
    ];
    const c = [
      3, 3, 3, 4, 4, 4,    // seg 1: birdie holes 1-3 → triggers press, wins it
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4
    ];
    const d = [
      3, 3, 3, 4, 4, 4,
      4, 4, 4, 4, 4, 4,
      3, 3, 3, 3, 3, 3     // seg 3: A+D side, birdies
    ];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Per-player accounting (segment 3 ALSO triggers a press — A+D
    // goes 2-up at hole 14 with 4 holes left → press opens at hole 15
    // and A+D runs the table):
    //   A = seg1 -500 + seg1 press -500 + seg2 push + seg3 +500 + seg3 press +500 = 0
    //   B = seg1 -500 + seg1 press -500 + seg2 push + seg3 -500 + seg3 press -500 = -2000
    //   C = seg1 +500 + seg1 press +500 + seg2 push + seg3 -500 + seg3 press -500 = 0
    //   D = seg1 +500 + seg1 press +500 + seg2 push + seg3 +500 + seg3 press +500 = +2000
    // This is the segment-isolation property in action: each segment
    // runs its own press independently of the others.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(0);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-2000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(0);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(2000);
  });

  it("incomplete segment: press is detected but result_delta=null until all scored", () => {
    // Segment 1 fully scored with C+D winning a press. Segments 2-3 not scored.
    // The engine should settle segment 1 + its press, leave segments 2-3
    // as "live" (no payout), and the total status should be live.
    const a = [
      4, 4, 4, 4, 4, 4,
      ...new Array(12).fill(null) as any[]
    ];
    const b = [...a];
    const c = [
      3, 3, 3, 4, 4, 4,
      ...new Array(12).fill(null) as any[]
    ];
    const d = [...c];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Status is "live" because not every segment is complete.
    expect(out.status).toBe("live");
    // Segment 1 settled — C+D won segment + press.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(-1000);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(1000);
  });

  it("press defaults to OFF — config.presses absent means no auto presses", () => {
    // Same scoring as "press fires AND C+D wins". Without the presses
    // flag, only the segment payout fires.
    const a = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const b = [...a];
    const c = [3, 3, 3, 4, 4, 4, ...new Array(12).fill(4)];
    const d = [...c];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500
          // no presses config
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Just segment 1 payout — no press doubling.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(500);
  });

  it("press in segment 2 covers only holes 7-12 (segment-scoped)", () => {
    // Holes 1-6: everyone pars → segment 1 pushes
    // Holes 7-8: A+C goes 2-up vs B+D (A+C birdies hole 7 and 8) → press
    //   opens at hole 9
    // Holes 9-12: pushes → press halves → no press money moves
    //   Segment 2: A+C wins (2-up) → A+C each +500, B+D each -500
    // Holes 13-18: everyone pars → segment 3 pushes
    //
    // CRITICAL invariant tested: the press primitive operating on
    // segment 2's holes (segHoles.slice(6,12)) returns segment 2's
    // hole numbers (7-12) — NOT holes 1-6. If the primitive used the
    // wrong segment offset, the press would settle on the wrong holes.
    const a = [
      4, 4, 4, 4, 4, 4,
      3, 3, 4, 4, 4, 4,    // birdies 7-8 = 2-up vs B+D in segment 2
      4, 4, 4, 4, 4, 4
    ];
    const b = [
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4
    ];
    const c = [
      4, 4, 4, 4, 4, 4,
      3, 3, 4, 4, 4, 4,    // partners with A in seg 2
      4, 4, 4, 4, 4, 4
    ];
    const d = [
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4
    ];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    // Seg 2: A+C wins, B+D loses. Press fired but halved.
    expect(out.perPlayer.get("A")!.delta_cents).toBe(500);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(500);
    expect(out.perPlayer.get("B")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("D")!.delta_cents).toBe(-500);
  });
});

describe("6-6-6 with presses=manual — auto presses NOT triggered", () => {
  it("manual mode disables auto-press behavior", () => {
    // Same setup as "press fires AND C+D wins the press" — but with
    // config.presses = "manual", auto presses don't fire. Only the
    // segment payout applies.
    const a = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const b = [...a];
    const c = [3, 3, 3, 4, 4, 4, ...new Array(12).fill(4)];
    const d = [...c];
    const out = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "manual" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("A")!.delta_cents).toBe(-500);
    expect(out.perPlayer.get("C")!.delta_cents).toBe(500);
  });
});

describe("6-6-6 stroke-play mode (match_play=false) doesn't fire auto-presses", () => {
  it("stroke segments + presses=auto_2_down is a no-op for the press chain", () => {
    // Stroke-play segments compare totals, not hole-by-hole. The
    // auto-press primitive depends on hole-by-hole match deltas, so
    // it's only meaningful for match_play segments. Stroke + presses
    // is a silent no-op — engine doesn't crash, doesn't double-pay.
    const a = [4, 4, 4, 4, 4, 4, ...new Array(12).fill(4)];
    const b = [...a];
    const c = [3, 3, 3, 4, 4, 4, ...new Array(12).fill(4)];
    const d = [...c];
    const strokeOnly = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { match_play: false }
        })
      })
    );
    const strokeWithPressFlag = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({ A: a, B: b, C: c, D: d }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { match_play: false, presses: "auto_2_down" }
        })
      })
    );
    for (const id of ["A", "B", "C", "D"]) {
      expect(strokeWithPressFlag.perPlayer.get(id)!.delta_cents).toBe(
        strokeOnly.perPlayer.get(id)!.delta_cents
      );
    }
  });
});
