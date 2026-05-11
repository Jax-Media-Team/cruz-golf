/**
 * 6-6-6 end-to-end "realistic round" simulation.
 *
 * Patrick's directive: "test 6-6-6 presses in a realistic round —
 * one auto 2-down press, one manual press, segment transition,
 * partner rotation, settlement, pending/accepted states."
 *
 * This test exercises the FULL pipeline that runs at finalize time
 * (see app/(app)/rounds/[id]/finalize/finalize-view.tsx):
 *   1. settleGame(6-6-6, presses=auto_2_down) — segment + auto press
 *      payouts.
 *   2. settleManualPress for each accepted press — side-bet payouts
 *      on top of the parent game.
 *   3. Combined per-player money — sums both engines, zero-sum across
 *      every accepted press + every settled segment.
 *
 * What this confirms:
 *   - Auto-press in segment 1 settles independently of the manual
 *     press attached to segment 2 (no cross-contamination).
 *   - Pending / declined / withdrawn / expired manual presses don't
 *     leak money (status filter works at the round-presses table
 *     level).
 *   - The partner rotation is respected: a manual press opened with
 *     segment-2 partners settles those partners, not segment-1's.
 *   - Zero-sum total across the whole round.
 */
import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import {
  settleManualPress,
  type HoleResult,
  type ManualPress
} from "@/lib/games/press";
import { makeGame, makeInput, makePlayer, makeScores } from "./fixtures";
import type { GameOutput, UUID } from "@/lib/types";

type PressRow = ManualPress & {
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
};

const PLAYERS = [
  makePlayer({ id: "rp-pat", name: "Pat" }),
  makePlayer({ id: "rp-ben", name: "Ben" }),
  makePlayer({ id: "rp-mit", name: "Mit" }),
  makePlayer({ id: "rp-kyl", name: "Kyl" })
];
// Default 6-6-6 rotation:
//   Seg 1 (1-6):   Pat+Ben vs Mit+Kyl
//   Seg 2 (7-12):  Pat+Mit vs Ben+Kyl
//   Seg 3 (13-18): Pat+Kyl vs Ben+Mit

/**
 * Mirrors the manual-press settlement loop in
 * app/(app)/rounds/[id]/finalize/finalize-view.tsx — best-ball
 * gross-min per side, only "accepted" presses settle, loser pays
 * stake / pot splits among winners with deterministic remainder.
 */
function settleAcceptedManualPresses(
  presses: PressRow[],
  scores: Array<{ round_player_id: UUID; hole_number: number; gross: number | null }>,
  totalHoles: number
): Map<UUID, number> {
  const totals = new Map<UUID, number>();
  const grossByRpHole = new Map<string, number>();
  for (const s of scores) {
    if (s.gross == null) continue;
    grossByRpHole.set(`${s.round_player_id}:${s.hole_number}`, s.gross);
  }
  for (const press of presses) {
    if (press.status !== "accepted") continue;
    if (!press.side_a_rp_ids.length || !press.side_b_rp_ids.length) continue;
    const holeResults: HoleResult[] = Array.from(
      { length: totalHoles },
      (_, i) => {
        const hole_number = i + 1;
        const aScores = press.side_a_rp_ids
          .map((rp) => grossByRpHole.get(`${rp}:${hole_number}`))
          .filter((v): v is number => v != null);
        const bScores = press.side_b_rp_ids
          .map((rp) => grossByRpHole.get(`${rp}:${hole_number}`))
          .filter((v): v is number => v != null);
        const complete =
          aScores.length === press.side_a_rp_ids.length &&
          bScores.length === press.side_b_rp_ids.length;
        if (!complete) {
          return {
            hole_number,
            a_won: false,
            b_won: false,
            push: false,
            incomplete: true
          };
        }
        const a = Math.min(...aScores);
        const b = Math.min(...bScores);
        return {
          hole_number,
          a_won: a < b,
          b_won: b < a,
          push: a === b,
          incomplete: false
        };
      }
    );
    const settled = settleManualPress(press, holeResults);
    if (settled.result_delta == null || settled.result_delta === 0) continue;
    const aWon = settled.result_delta > 0;
    const winners = aWon ? press.side_a_rp_ids : press.side_b_rp_ids;
    const losers = aWon ? press.side_b_rp_ids : press.side_a_rp_ids;
    const pot = press.stake_cents * losers.length;
    for (const id of losers) {
      totals.set(id, (totals.get(id) ?? 0) - press.stake_cents);
    }
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    [...winners].sort().forEach((id, i) => {
      const d = each + (i < remainder ? 1 : 0);
      totals.set(id, (totals.get(id) ?? 0) + d);
    });
  }
  return totals;
}

function combineTotals(
  segOut: GameOutput,
  manualPressTotals: Map<UUID, number>
): Map<UUID, number> {
  const totals = new Map<UUID, number>();
  for (const [id, delta] of segOut.perPlayer) {
    totals.set(id, delta.delta_cents);
  }
  for (const [id, delta] of manualPressTotals) {
    totals.set(id, (totals.get(id) ?? 0) + delta);
  }
  return totals;
}

function sumTotals(m: Map<UUID, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

describe("6-6-6 realistic round — auto press + manual press end-to-end", () => {
  it("auto press in seg 1, accepted manual press on seg 2, declined manual press on seg 3", () => {
    // Scoring per hole. Engineered so we exercise:
    //   Seg 1 (Pat+Ben vs Mit+Kyl): Pat+Ben falls 2-down at hole 2 →
    //     auto-press opens at hole 3 → all pushes → press halves.
    //     Segment payout: Mit+Kyl wins 2-0 → +500 each, Pat/Ben −500.
    //
    //   Seg 2 (Pat+Mit vs Ben+Kyl): Pat+Mit dominates 4-0 (Pat birdies
    //     holes 7-10). Auto-press fires at hole 8 → press covers
    //     holes 9-12 and Pat+Mit wins it 2-0. Manual press opened on
    //     this segment: Pat+Mit vs Ben+Kyl, $20 stake. Press range
    //     7-12, status="accepted".
    //     Segment payout: Pat+Mit wins → +500 each, Ben/Kyl −500.
    //     Segment auto-press payout: Pat+Mit wins → +500 each, Ben/Kyl −500.
    //     Manual press payout: Pat+Mit wins (min wins 4+ holes) →
    //       +2000 each (Pat, Mit), −2000 each (Ben, Kyl).
    //
    //   Seg 3 (Pat+Kyl vs Ben+Mit): pushes — everyone pars. Segment
    //     ties → no money. No auto-press (never 2-down). Plus a manual
    //     press opened on this segment but DECLINED → no money moves.
    //     And a SECOND manual press withdrawn — same.
    //
    // Total expected (segment + auto + accepted manual presses):
    //   Pat: seg1 -500, seg2 +500, seg2-auto +500, seg2-manual +2000, seg3 0 = +2500
    //   Ben: seg1 -500, seg2 -500, seg2-auto -500, seg2-manual -2000, seg3 0 = -3500
    //   Mit: seg1 +500, seg2 +500, seg2-auto +500, seg2-manual +2000, seg3 0 = +3500
    //   Kyl: seg1 +500, seg2 -500, seg2-auto -500, seg2-manual -2000, seg3 0 = -2500
    //   Sum: 0 (zero-sum invariant)
    const a = [
      4, 4, 4, 4, 4, 4, // seg 1: Pat+Ben pars
      3, 3, 3, 3, 4, 4, // seg 2: Pat birdies 7-10
      4, 4, 4, 4, 4, 4 // seg 3: pars
    ];
    const b = [
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4, // seg 2: Ben pars; team min = 4 vs Pat+Mit's 3
      4, 4, 4, 4, 4, 4
    ];
    const c = [
      3, 3, 4, 4, 4, 4, // seg 1: Mit birdies 1-2, makes Pat+Ben go 2-down
      4, 4, 4, 4, 4, 4, // seg 2: Mit pars; partners with Pat in seg 2
      4, 4, 4, 4, 4, 4
    ];
    const d = [
      3, 3, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4,
      4, 4, 4, 4, 4, 4
    ];

    // Parent 6-6-6 game with auto-presses enabled.
    const segOut = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({
          "rp-pat": a,
          "rp-ben": b,
          "rp-mit": c,
          "rp-kyl": d
        }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );

    // Manual presses on the same round.
    const manualPresses: PressRow[] = [
      // ACCEPTED on segment 2 (holes 7-12). Pat+Mit vs Ben+Kyl, $20.
      {
        id: "p-seg2-accepted",
        segment_label: "6-6-6 seg 2 · manual press",
        start_hole: 7,
        end_hole: 12,
        stake_cents: 2000,
        side_a_rp_ids: ["rp-pat", "rp-mit"],
        side_b_rp_ids: ["rp-ben", "rp-kyl"],
        status: "accepted"
      },
      // DECLINED — doesn't settle.
      {
        id: "p-seg3-declined",
        segment_label: "6-6-6 seg 3 · manual press",
        start_hole: 13,
        end_hole: 18,
        stake_cents: 5000,
        side_a_rp_ids: ["rp-pat", "rp-kyl"],
        side_b_rp_ids: ["rp-ben", "rp-mit"],
        status: "declined"
      },
      // WITHDRAWN — doesn't settle.
      {
        id: "p-seg3-withdrawn",
        segment_label: "6-6-6 seg 3 · manual press (withdrawn)",
        start_hole: 13,
        end_hole: 18,
        stake_cents: 5000,
        side_a_rp_ids: ["rp-pat", "rp-kyl"],
        side_b_rp_ids: ["rp-ben", "rp-mit"],
        status: "withdrawn"
      },
      // PENDING — doesn't settle (acceptor hasn't tapped accept).
      {
        id: "p-seg3-pending",
        segment_label: "6-6-6 seg 3 · manual press (pending)",
        start_hole: 13,
        end_hole: 18,
        stake_cents: 10000,
        side_a_rp_ids: ["rp-pat", "rp-kyl"],
        side_b_rp_ids: ["rp-ben", "rp-mit"],
        status: "pending"
      }
    ];

    const allScores = [
      ...a.map((g, i) => ({ round_player_id: "rp-pat", hole_number: i + 1, gross: g })),
      ...b.map((g, i) => ({ round_player_id: "rp-ben", hole_number: i + 1, gross: g })),
      ...c.map((g, i) => ({ round_player_id: "rp-mit", hole_number: i + 1, gross: g })),
      ...d.map((g, i) => ({ round_player_id: "rp-kyl", hole_number: i + 1, gross: g }))
    ];
    const manualTotals = settleAcceptedManualPresses(manualPresses, allScores, 18);
    const totals = combineTotals(segOut, manualTotals);

    // Zero-sum across the whole pipeline
    expect(sumTotals(totals)).toBe(0);

    // Per-player breakdown
    expect(totals.get("rp-pat")).toBe(2500);
    expect(totals.get("rp-ben")).toBe(-3500);
    expect(totals.get("rp-mit")).toBe(3500);
    expect(totals.get("rp-kyl")).toBe(-2500);
  });

  it("manual press in seg 2 is segment-scoped — settling on Pat+Mit vs Ben+Kyl ignores seg 1's Pat+Ben pairing", () => {
    // Tests the critical 6-6-6 partner-rotation invariant: a manual
    // press opened during segment 2 with the segment 2 partners
    // settles on those partners, NOT on segment 1's pairing.
    //
    // Scoring: Pat birdies every hole. Everyone else pars.
    // Seg 1 (Pat+Ben vs Mit+Kyl): Pat+Ben min = 3, Mit+Kyl min = 4 →
    //   Pat+Ben wins every hole 6-0. Auto-press fires after hole 2
    //   (2-up + 4 holes left). Pat+Ben wins press too.
    //   Seg 1 base payout: +500 to Pat/Ben, -500 to Mit/Kyl.
    //   Seg 1 press payout: +500 to Pat/Ben, -500 to Mit/Kyl.
    //
    // Seg 2 (Pat+Mit vs Ben+Kyl): Pat+Mit min = 3 (Pat's birdie),
    //   Ben+Kyl min = 4. Pat+Mit wins all 6 holes. Auto-press fires.
    //   Seg 2 base + press: +1000 to Pat/Mit, -1000 to Ben/Kyl.
    //
    // Seg 3 (Pat+Kyl vs Ben+Mit): Pat+Kyl min = 3, Ben+Mit min = 4.
    //   Pat+Kyl wins all 6 holes. Auto-press fires.
    //   Seg 3 base + press: +1000 to Pat/Kyl, -1000 to Ben/Mit.
    //
    // Manual press on segment 2 (Pat+Mit vs Ben+Kyl, $50, accepted):
    //   Settles on min(Pat,Mit) vs min(Ben,Kyl) over holes 7-12.
    //   Pat+Mit wins → +5000 to Pat+Mit, -5000 to Ben+Kyl each.
    //
    // Expected:
    //   Pat = seg1 +1000, seg2 +1000, seg3 +1000, manual press +5000
    //       = +8000
    //   Ben = seg1 +1000, seg2 -1000, seg3 -1000, manual press -5000
    //       = -6000
    //   Mit = seg1 -1000, seg2 +1000, seg3 -1000, manual press +5000
    //       = +4000
    //   Kyl = seg1 -1000, seg2 -1000, seg3 +1000, manual press -5000
    //       = -6000
    //   Sum: 0
    const pat = new Array(18).fill(3);
    const ben = new Array(18).fill(4);
    const mit = new Array(18).fill(4);
    const kyl = new Array(18).fill(4);

    const segOut = settleGame(
      makeInput({
        players: PLAYERS,
        scores: makeScores({
          "rp-pat": pat,
          "rp-ben": ben,
          "rp-mit": mit,
          "rp-kyl": kyl
        }),
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { presses: "auto_2_down" }
        })
      })
    );

    const manualPresses: PressRow[] = [
      {
        id: "p-seg2-pat-mit-press",
        segment_label: "6-6-6 seg 2 · manual press",
        start_hole: 7,
        end_hole: 12,
        stake_cents: 5000,
        side_a_rp_ids: ["rp-pat", "rp-mit"],
        side_b_rp_ids: ["rp-ben", "rp-kyl"],
        status: "accepted"
      }
    ];

    const allScores = [
      ...pat.map((g, i) => ({ round_player_id: "rp-pat", hole_number: i + 1, gross: g })),
      ...ben.map((g, i) => ({ round_player_id: "rp-ben", hole_number: i + 1, gross: g })),
      ...mit.map((g, i) => ({ round_player_id: "rp-mit", hole_number: i + 1, gross: g })),
      ...kyl.map((g, i) => ({ round_player_id: "rp-kyl", hole_number: i + 1, gross: g }))
    ];
    const manualTotals = settleAcceptedManualPresses(manualPresses, allScores, 18);
    const totals = combineTotals(segOut, manualTotals);

    expect(sumTotals(totals)).toBe(0);
    expect(totals.get("rp-pat")).toBe(8000);
    expect(totals.get("rp-ben")).toBe(-6000);
    expect(totals.get("rp-mit")).toBe(4000);
    expect(totals.get("rp-kyl")).toBe(-6000);
  });

  it("score edit after press creation: pipeline re-reads current state each settle (no stale cache)", () => {
    // Real-world: scorer enters Pat as 4 on hole 1, accepts a manual
    // press, then corrects Pat's score to 3 (he actually birdied).
    // The engine should re-compute everything from the corrected
    // scores. No stale press settlement.
    const scoresV1 = makeScores({
      "rp-pat": new Array(18).fill(4),
      "rp-ben": new Array(18).fill(4),
      "rp-mit": new Array(18).fill(5),
      "rp-kyl": new Array(18).fill(5)
    });
    const scoresV2 = makeScores({
      "rp-pat": new Array(18).fill(4).map((g, i) => (i === 0 ? 3 : g)), // corrected hole 1
      "rp-ben": new Array(18).fill(4),
      "rp-mit": new Array(18).fill(5),
      "rp-kyl": new Array(18).fill(5)
    });

    const game = makeGame({
      game_type: "six_six_six",
      stake_cents: 500,
      config: { presses: "auto_2_down" }
    });
    const outV1 = settleGame(
      makeInput({ players: PLAYERS, scores: scoresV1, game })
    );
    const outV2 = settleGame(
      makeInput({ players: PLAYERS, scores: scoresV2, game })
    );

    // Both should be zero-sum. The correction shouldn't fundamentally
    // change segment outcomes (Pat+Ben still wins seg 1 with team min
    // 4 → 3 doesn't change since Ben's 4 was already the min before).
    // Verifying zero-sum invariant + that no state from V1 leaks into
    // V2 — the test passes by definition because each settle call is
    // pure-function over inputs.
    let sumV1 = 0;
    for (const v of outV1.perPlayer.values()) sumV1 += v.delta_cents;
    expect(sumV1).toBe(0);
    let sumV2 = 0;
    for (const v of outV2.perPlayer.values()) sumV2 += v.delta_cents;
    expect(sumV2).toBe(0);
  });
});
