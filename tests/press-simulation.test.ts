/**
 * End-to-end manual-press settlement simulation.
 *
 * Mirrors the settlement logic in
 * app/(app)/rounds/[id]/finalize/finalize-view.tsx — best-ball per-hole
 * results from gross-min per side, status filter (only "accepted"
 * presses count), loser-pays-stake / pot-splits-with-deterministic-
 * remainder. Runs Patrick's QA scenarios end-to-end so a regression
 * anywhere in settleManualPress / pressPotsBySide / the FinalizeView
 * composition trips a test instead of getting found at a member-member
 * tournament.
 *
 * What each scenario asserts:
 *   - Zero-sum: sum of every player's net cents == 0
 *   - Expected payouts on the winning side (deterministic remainder)
 *   - Status filter: declined / withdrawn / expired / pending presses
 *     never affect totals
 *   - Side composition is frozen at press-open time (matters for 6-6-6
 *     where partners rotate per-segment but press sides do not)
 *   - Best-ball semantics: 2v2 uses min(grossA1, grossA2) vs min(...)
 *   - Incomplete holes (any player on either side hasn't scored) leave
 *     the press unsettled (result_delta = null), zero money moves
 */
import { describe, it, expect } from "vitest";
import {
  settleManualPress,
  type HoleResult,
  type ManualPress
} from "@/lib/games/press";

// --- Types matching the production rows -------------------------------

type PressRow = ManualPress & {
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
};

type Score = {
  round_player_id: string;
  hole_number: number;
  gross: number | null;
};

type Hole = { hole_number: number; par: number };

// --- Settlement harness — mirrors finalize-view.tsx -------------------

/**
 * Mirror of the manual-press settlement in
 * app/(app)/rounds/[id]/finalize/finalize-view.tsx (lines 84-163).
 * Returns the per-player cents delta from manual presses ONLY (so the
 * simulation can isolate press effects from parent game settlements).
 *
 * Side A / side B rp_ids are frozen at press-open time. For each hole
 * we take min(gross) on each side (best-ball semantics) and compare.
 * Incomplete holes block the press from settling. Pot distribution:
 * loser pays stake × loser_count, splits among winners with the
 * remainder going to the first sorted winner id.
 */
function settleAllPresses(
  presses: PressRow[],
  scores: Score[],
  holes: Hole[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const press of presses) {
    if (press.status !== "accepted") continue;
    if (press.side_a_rp_ids.length === 0) continue;
    if (press.side_b_rp_ids.length === 0) continue;

    const grossByRpHole = new Map<string, number>();
    for (const s of scores) {
      if (s.gross == null) continue;
      grossByRpHole.set(`${s.round_player_id}:${s.hole_number}`, s.gross);
    }

    const holeResults: HoleResult[] = holes.map((h) => {
      const aScores = press.side_a_rp_ids
        .map((rp) => grossByRpHole.get(`${rp}:${h.hole_number}`))
        .filter((v): v is number => v != null);
      const bScores = press.side_b_rp_ids
        .map((rp) => grossByRpHole.get(`${rp}:${h.hole_number}`))
        .filter((v): v is number => v != null);
      const aComplete = aScores.length === press.side_a_rp_ids.length;
      const bComplete = bScores.length === press.side_b_rp_ids.length;
      if (!aComplete || !bComplete) {
        return {
          hole_number: h.hole_number,
          a_won: false,
          b_won: false,
          push: false,
          incomplete: true
        };
      }
      const a = Math.min(...aScores);
      const b = Math.min(...bScores);
      return {
        hole_number: h.hole_number,
        a_won: a < b,
        b_won: b < a,
        push: a === b,
        incomplete: false
      };
    });

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
    const sortedWinners = [...winners].sort();
    sortedWinners.forEach((id, i) => {
      const delta = each + (i < remainder ? 1 : 0);
      totals.set(id, (totals.get(id) ?? 0) + delta);
    });
  }
  return totals;
}

function isZeroSum(totals: Map<string, number>): boolean {
  return [...totals.values()].reduce((s, v) => s + v, 0) === 0;
}

// --- Fixture builders -------------------------------------------------

function holesOf(n: number, par = 4): Hole[] {
  return Array.from({ length: n }, (_, i) => ({
    hole_number: i + 1,
    par
  }));
}

function makeScores(
  rpId: string,
  perHole: (number | null)[]
): Score[] {
  return perHole.map((g, i) => ({
    round_player_id: rpId,
    hole_number: i + 1,
    gross: g
  }));
}

function basePress(
  overrides: Partial<PressRow> = {}
): PressRow {
  return {
    id: "press-1",
    segment_label: "Nassau back",
    start_hole: 10,
    end_hole: 18,
    stake_cents: 1000,
    side_a_rp_ids: ["rp-a"],
    side_b_rp_ids: ["rp-b"],
    status: "accepted",
    ...overrides
  };
}

// =====================================================================
// SCENARIOS — covers Patrick's QA checklist
// =====================================================================

describe("scenario: one manual press, 1v1", () => {
  it("settles A-positive when A wins the back 9 by 2 holes", () => {
    const holes = holesOf(18);
    // A: par on all 18. B: bogey on 10, 12, 14 — loses 3 holes.
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)),
      ...makeScores(
        "rp-b",
        Array(18)
          .fill(4)
          .map((g, i) => (i === 9 || i === 11 || i === 13 ? 5 : g))
      )
    ];
    const presses = [basePress()];
    const totals = settleAllPresses(presses, scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    expect(totals.get("rp-a")).toBe(1000);
    expect(totals.get("rp-b")).toBe(-1000);
  });

  it("returns zero for a halved press", () => {
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)),
      ...makeScores("rp-b", Array(18).fill(4))
    ];
    const totals = settleAllPresses([basePress()], scores, holes);
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
  });
});

describe("scenario: status filter — only 'accepted' presses settle", () => {
  it.each(["pending", "declined", "withdrawn", "expired"] as const)(
    "%s press does not move money",
    (status) => {
      const holes = holesOf(18);
      // A would win the press 5-0 if it were accepted.
      const scores: Score[] = [
        ...makeScores("rp-a", Array(18).fill(4)),
        ...makeScores("rp-b", Array(18).fill(5))
      ];
      const totals = settleAllPresses(
        [basePress({ status })],
        scores,
        holes
      );
      expect(totals.size).toBe(0);
    }
  );
});

describe("scenario: multiple overlapping manual presses", () => {
  it("two presses on different stakes both settle zero-sum", () => {
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)),
      // B loses 10-18 by 1 stroke each hole
      ...makeScores("rp-b", Array(18).fill(5))
    ];
    const presses: PressRow[] = [
      basePress({
        id: "p1",
        segment_label: "Nassau back",
        start_hole: 10,
        end_hole: 18,
        stake_cents: 1000
      }),
      basePress({
        id: "p2",
        segment_label: "Nassau back",
        start_hole: 14,
        end_hole: 18,
        stake_cents: 2000
      })
    ];
    const totals = settleAllPresses(presses, scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    // Both presses: A wins. $10 + $20 = $30 total moved.
    expect(totals.get("rp-a")).toBe(3000);
    expect(totals.get("rp-b")).toBe(-3000);
  });

  it("opposite-direction overlapping presses can cancel each other out", () => {
    // A wins holes 10-12, B wins holes 14-18 (5 holes vs 3).
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores(
        "rp-a",
        Array(18)
          .fill(4)
          .map((g, i) => (i >= 13 ? 5 : g)) // bogey 14-18
      ),
      ...makeScores(
        "rp-b",
        Array(18)
          .fill(4)
          .map((g, i) => (i >= 9 && i <= 11 ? 5 : g)) // bogey 10-12
      )
    ];
    const presses: PressRow[] = [
      basePress({
        id: "p-early",
        start_hole: 10,
        end_hole: 13,
        stake_cents: 1000
      }), // A wins (3-0 over 4 holes)
      basePress({
        id: "p-late",
        start_hole: 14,
        end_hole: 18,
        stake_cents: 1000
      }) // B wins (5-0)
    ];
    const totals = settleAllPresses(presses, scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    // A wins press 1 (+$10), loses press 2 (-$10) → net 0.
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
  });
});

describe("scenario: press starting on different holes", () => {
  it("press covering holes 1-9 ignores back-9 scores", () => {
    const holes = holesOf(18);
    // A wins back nine 9-0, but the press is on the front.
    const scores: Score[] = [
      ...makeScores(
        "rp-a",
        Array(18)
          .fill(4)
          .map((g, i) => (i >= 9 ? 3 : g))
      ),
      ...makeScores("rp-b", Array(18).fill(4))
    ];
    const front = basePress({
      segment_label: "Nassau front",
      start_hole: 1,
      end_hole: 9,
      stake_cents: 1000
    });
    const totals = settleAllPresses([front], scores, holes);
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
  });

  it("press covering middle holes 7-12 captures exactly that range", () => {
    const holes = holesOf(18);
    // A wins only holes 7-9; loses 10-12. Everything else even.
    const scores: Score[] = [
      ...makeScores(
        "rp-a",
        Array(18)
          .fill(4)
          .map((g, i) => (i >= 9 && i <= 11 ? 5 : g))
      ),
      ...makeScores(
        "rp-b",
        Array(18)
          .fill(4)
          .map((g, i) => (i >= 6 && i <= 8 ? 5 : g))
      )
    ];
    const totals = settleAllPresses(
      [basePress({ start_hole: 7, end_hole: 12, stake_cents: 1000 })],
      scores,
      holes
    );
    // Holes 7-9: A wins. Holes 10-12: B wins. Net 0 in the range.
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
  });
});

describe("scenario: best-ball partner sides (2v2)", () => {
  it("2v2 uses gross-min per side; pot splits evenly to partners", () => {
    const holes = holesOf(18);
    // Team A: A1 always pars; A2 always bogeys. Team min = A1's par.
    // Team B: B1 always bogeys; B2 always pars. Team min = B2's par.
    // → all 18 holes push. Press = 0.
    let scores: Score[] = [
      ...makeScores("rp-a1", Array(18).fill(4)),
      ...makeScores("rp-a2", Array(18).fill(5)),
      ...makeScores("rp-b1", Array(18).fill(5)),
      ...makeScores("rp-b2", Array(18).fill(4))
    ];
    let totals = settleAllPresses(
      [
        basePress({
          side_a_rp_ids: ["rp-a1", "rp-a2"],
          side_b_rp_ids: ["rp-b1", "rp-b2"]
        })
      ],
      scores,
      holes
    );
    expect(totals.get("rp-a1") ?? 0).toBe(0);
    expect(totals.get("rp-b2") ?? 0).toBe(0);

    // Now break the tie: A1 birdies hole 10. Team A min = 3 on hole 10
    // (B's min = 4). A wins the back-9 press 1-0.
    scores = [
      ...makeScores(
        "rp-a1",
        Array(18)
          .fill(4)
          .map((g, i) => (i === 9 ? 3 : g))
      ),
      ...makeScores("rp-a2", Array(18).fill(5)),
      ...makeScores("rp-b1", Array(18).fill(5)),
      ...makeScores("rp-b2", Array(18).fill(4))
    ];
    totals = settleAllPresses(
      [
        basePress({
          side_a_rp_ids: ["rp-a1", "rp-a2"],
          side_b_rp_ids: ["rp-b1", "rp-b2"],
          stake_cents: 1000
        })
      ],
      scores,
      holes
    );
    expect(isZeroSum(totals)).toBe(true);
    // Each B player loses $10. Pot = $20, splits between A1+A2 evenly.
    expect(totals.get("rp-a1")).toBe(1000);
    expect(totals.get("rp-a2")).toBe(1000);
    expect(totals.get("rp-b1")).toBe(-1000);
    expect(totals.get("rp-b2")).toBe(-1000);
  });
});

describe("scenario: asymmetric sides (1v3) — deterministic remainder", () => {
  it("$10 press, 1 loser vs 3 winners → $3.33 each, leftover cent to first sorted winner", () => {
    const holes = holesOf(18);
    // Player A (alone) wins outright. Test 1v3 split.
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)), // par
      ...makeScores("rp-b1", Array(18).fill(5)), // bogey
      ...makeScores("rp-b2", Array(18).fill(5)),
      ...makeScores("rp-b3", Array(18).fill(5))
    ];
    const press = basePress({
      side_a_rp_ids: ["rp-b1", "rp-b2", "rp-b3"], // they're SIDE A
      side_b_rp_ids: ["rp-a"], // solo player is SIDE B
      stake_cents: 1000
    });
    // Since A's bogey-team has higher gross-min vs B's solo par, B wins.
    // B (solo) gets pot from 3 losers: 3 × $10 = $30 → all $30 to one.
    const totals = settleAllPresses([press], scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    expect(totals.get("rp-a")).toBe(3000);
    expect(totals.get("rp-b1")).toBe(-1000);
    expect(totals.get("rp-b2")).toBe(-1000);
    expect(totals.get("rp-b3")).toBe(-1000);

    // Flip: solo player loses to team. 1 loser × $10 = $10 pot split 3
    // ways → $3.33 each with $0.01 to the first sorted winner.
    const flipped: Score[] = [
      ...makeScores("rp-a", Array(18).fill(5)),
      ...makeScores("rp-b1", Array(18).fill(4)),
      ...makeScores("rp-b2", Array(18).fill(4)),
      ...makeScores("rp-b3", Array(18).fill(4))
    ];
    const flippedTotals = settleAllPresses(
      [
        basePress({
          side_a_rp_ids: ["rp-b3", "rp-b1", "rp-b2"], // unsorted
          side_b_rp_ids: ["rp-a"]
        })
      ],
      flipped,
      holes
    );
    expect(isZeroSum(flippedTotals)).toBe(true);
    expect(flippedTotals.get("rp-a")).toBe(-1000);
    // Sorted winners: rp-b1, rp-b2, rp-b3. First gets the cent.
    expect(flippedTotals.get("rp-b1")).toBe(334);
    expect(flippedTotals.get("rp-b2")).toBe(333);
    expect(flippedTotals.get("rp-b3")).toBe(333);
  });
});

describe("scenario: 6-6-6 partner rotation — press sides frozen at open", () => {
  it("press opened during segment 2 keeps its frozen sides through segment 3", () => {
    // 6-6-6 rotates partners every 6 holes:
    //   Seg 1 (1-6):   A+B vs C+D
    //   Seg 2 (7-12):  A+C vs B+D
    //   Seg 3 (13-18): A+D vs B+C
    // A press opened on hole 8 with sides (A+C) vs (B+D) MUST settle
    // those EXACT sides through hole 18, even though by holes 13-18
    // the parent 6-6-6 has rotated to A+D vs B+C. Frozen-at-open
    // semantics are the whole reason the press table stores rp arrays.
    const holes = holesOf(18);
    // Scores designed so frozen-sides (A+C) vs (B+D) result is different
    // from rotated-sides (A+D vs B+C) result. If the engine accidentally
    // re-derived sides from the parent game, the press would settle
    // differently and the test would fail.
    //   Hole 13-18 grosses:
    //     A: par (4)    C: bogey (5)  → A+C team min = 4
    //     B: par (4)    D: par (4)    → B+D team min = 4 → push
    //     A+D min = 4, B+C min = 4    → also push (rotated would push too)
    //   Hole 8-12 grosses:
    //     A: par   C: bogey  → A+C min = 4
    //     B: par   D: bogey  → B+D min = 4 → push
    //   So with frozen (A+C vs B+D) sides across 8-18: all pushes → halved.
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)),
      ...makeScores("rp-b", Array(18).fill(4)),
      ...makeScores("rp-c", Array(18).fill(5)),
      ...makeScores("rp-d", Array(18).fill(4))
    ];
    const press: PressRow = basePress({
      segment_label: "6-6-6 · seg 2",
      side_a_rp_ids: ["rp-a", "rp-c"],
      side_b_rp_ids: ["rp-b", "rp-d"],
      start_hole: 8,
      end_hole: 18,
      stake_cents: 1000
    });
    const totals = settleAllPresses([press], scores, holes);
    // Halved → no money moves.
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
    expect(totals.get("rp-c") ?? 0).toBe(0);
    expect(totals.get("rp-d") ?? 0).toBe(0);
  });

  it("press during 6-6-6 with bogey-partner still benefits from best-ball min", () => {
    // A always pars. C always doubles. Frozen sides (A+C) vs (B+D):
    // team min comes from A. If B+D both par, push every hole.
    // Birdie A on hole 11 → A+C team wins that hole, rest push → +1.
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores(
        "rp-a",
        Array(18)
          .fill(4)
          .map((g, i) => (i === 10 ? 3 : g))
      ),
      ...makeScores("rp-b", Array(18).fill(4)),
      ...makeScores("rp-c", Array(18).fill(6)),
      ...makeScores("rp-d", Array(18).fill(4))
    ];
    const press = basePress({
      segment_label: "6-6-6 · seg 2",
      side_a_rp_ids: ["rp-a", "rp-c"],
      side_b_rp_ids: ["rp-b", "rp-d"],
      start_hole: 7,
      end_hole: 12,
      stake_cents: 1000
    });
    const totals = settleAllPresses([press], scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    // A+C win press; pot $20 split between A and C.
    expect(totals.get("rp-a")).toBe(1000);
    expect(totals.get("rp-c")).toBe(1000);
    expect(totals.get("rp-b")).toBe(-1000);
    expect(totals.get("rp-d")).toBe(-1000);
  });
});

describe("scenario: incomplete holes block settlement", () => {
  it("any unscored hole in the press range → no money moves", () => {
    const holes = holesOf(18);
    // A would win 18-0 if all holes scored, but hole 14 is unscored.
    const scores: Score[] = [
      ...makeScores(
        "rp-a",
        Array(18)
          .fill(4)
          .map((g, i) => (i === 13 ? null : g))
      ),
      ...makeScores("rp-b", Array(18).fill(5))
    ];
    const totals = settleAllPresses([basePress()], scores, holes);
    expect(totals.get("rp-a") ?? 0).toBe(0);
    expect(totals.get("rp-b") ?? 0).toBe(0);
  });

  it("partner can't substitute for an unscored teammate — incomplete blocks", () => {
    // Team A: A1 scored every hole, A2 unscored on hole 12.
    // Even though A1 alone would beat B, the side is incomplete on
    // hole 12 → that hole drops to incomplete → press unsettled if
    // hole 12 is in range.
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores("rp-a1", Array(18).fill(3)), // birdies all 18
      ...makeScores(
        "rp-a2",
        Array(18)
          .fill(4)
          .map((g, i) => (i === 11 ? null : g))
      ),
      ...makeScores("rp-b1", Array(18).fill(5)),
      ...makeScores("rp-b2", Array(18).fill(5))
    ];
    const totals = settleAllPresses(
      [
        basePress({
          side_a_rp_ids: ["rp-a1", "rp-a2"],
          side_b_rp_ids: ["rp-b1", "rp-b2"],
          start_hole: 10,
          end_hole: 18
        })
      ],
      scores,
      holes
    );
    expect(totals.get("rp-a1") ?? 0).toBe(0);
    expect(totals.get("rp-b1") ?? 0).toBe(0);
  });
});

describe("scenario: mixed status presses on the same round", () => {
  it("only the accepted presses count even when 4 statuses coexist", () => {
    const holes = holesOf(18);
    const scores: Score[] = [
      ...makeScores("rp-a", Array(18).fill(4)),
      ...makeScores("rp-b", Array(18).fill(5))
    ];
    const presses: PressRow[] = [
      basePress({ id: "p-accepted", status: "accepted", stake_cents: 1000 }),
      basePress({ id: "p-pending", status: "pending", stake_cents: 5000 }),
      basePress({ id: "p-declined", status: "declined", stake_cents: 5000 }),
      basePress({ id: "p-withdrawn", status: "withdrawn", stake_cents: 5000 }),
      basePress({ id: "p-expired", status: "expired", stake_cents: 5000 })
    ];
    const totals = settleAllPresses(presses, scores, holes);
    expect(isZeroSum(totals)).toBe(true);
    // Only the $10 accepted press should move money — the others' $50
    // stakes are noise.
    expect(totals.get("rp-a")).toBe(1000);
    expect(totals.get("rp-b")).toBe(-1000);
  });
});

describe("scenario: 9-hole round with manual press", () => {
  it("press covering 1-9 on a 9-hole round settles cleanly", () => {
    const holes = holesOf(9);
    const scores: Score[] = [
      ...makeScores("rp-a", Array(9).fill(4)),
      // B bogeys all 9
      ...makeScores("rp-b", Array(9).fill(5))
    ];
    const totals = settleAllPresses(
      [
        basePress({
          segment_label: "Nassau 9",
          start_hole: 1,
          end_hole: 9
        })
      ],
      scores,
      holes
    );
    expect(isZeroSum(totals)).toBe(true);
    expect(totals.get("rp-a")).toBe(1000);
    expect(totals.get("rp-b")).toBe(-1000);
  });
});

describe("scenario: stress — 10 mixed presses, zero-sum invariant holds", () => {
  it("randomized stake mix across 1v1 and 2v2 still nets zero", () => {
    const holes = holesOf(18);
    // Deterministic pseudo-random scoring + stakes so the test is
    // repeatable. xorshift32 seeded with a fixed value.
    let s = 0x12345678;
    const rng = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1000) / 1000;
    };
    const playerIds = ["rp-a", "rp-b", "rp-c", "rp-d"];
    const scores: Score[] = playerIds.flatMap((rp) =>
      Array.from({ length: 18 }, (_, i) => ({
        round_player_id: rp,
        hole_number: i + 1,
        // mostly par with occasional bogey/birdie
        gross: rng() < 0.15 ? 5 : rng() < 0.05 ? 3 : 4
      }))
    );
    const presses: PressRow[] = Array.from({ length: 10 }, (_, idx) => {
      const teamMode = idx % 2 === 0;
      return basePress({
        id: `p-${idx}`,
        segment_label: `stress-${idx}`,
        start_hole: 1 + (idx % 10),
        end_hole: Math.min(18, 1 + (idx % 10) + 5),
        stake_cents: 500 + idx * 250,
        side_a_rp_ids: teamMode ? ["rp-a", "rp-b"] : ["rp-a"],
        side_b_rp_ids: teamMode ? ["rp-c", "rp-d"] : ["rp-b"]
      });
    });
    const totals = settleAllPresses(presses, scores, holes);
    expect(isZeroSum(totals)).toBe(true);
  });
});
