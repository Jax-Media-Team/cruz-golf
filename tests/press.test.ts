import { describe, it, expect } from "vitest";
import {
  detectAutoPresses,
  pressPotsBySide,
  settleManualPress,
  type HoleResult,
  type ManualPress,
  type PressOpts
} from "@/lib/games/press";

function holeResult(
  num: number,
  who: "a" | "b" | "push" | "pending"
): HoleResult {
  return {
    hole_number: num,
    a_won: who === "a",
    b_won: who === "b",
    push: who === "push",
    incomplete: who === "pending"
  };
}

const baseOpts: PressOpts = {
  triggerDown: 2,
  minRemainingHoles: 3,
  maxPresses: 4,
  stakeCents: 1000,
  segmentLabel: "Nassau front",
  segmentStart: 0,
  segmentEnd: 9
};

describe("detectAutoPresses", () => {
  it("returns nothing when no side ever reaches the trigger threshold", () => {
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "b"),
      holeResult(3, "a"),
      holeResult(4, "b"),
      holeResult(5, "push"),
      holeResult(6, "a"),
      holeResult(7, "b"),
      holeResult(8, "push"),
      holeResult(9, "a")
    ];
    expect(detectAutoPresses(holes, baseOpts)).toEqual([]);
  });

  it("opens a press when one side falls 2 down with enough holes left", () => {
    // A wins holes 1-2 → delta +2 at end of hole 2 → press opens; press
    // covers holes 3-9 (7 holes remaining).
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "a"),
      holeResult(3, "push"),
      holeResult(4, "b"),
      holeResult(5, "a"),
      holeResult(6, "b"),
      holeResult(7, "a"),
      holeResult(8, "push"),
      holeResult(9, "b")
    ];
    const out = detectAutoPresses(holes, baseOpts);
    expect(out).toHaveLength(1);
    expect(out[0].trigger_hole).toBe(2);
    expect(out[0].start_hole).toBe(3);
    expect(out[0].end_hole).toBe(9);
    // Press holes (3-9): push, b, a, b, a, push, b → -2+1-1+1-1 = wait let me recount
    // 3:push (0), 4:b (-1), 5:a (+1), 6:b (-1), 7:a (+1), 8:push (0), 9:b (-1)
    // Net = -1
    expect(out[0].result_delta).toBe(-1);
  });

  it("does NOT open a press when remaining holes < minRemainingHoles", () => {
    // 8 holes pass evenly, then A wins hole 8 to go +2 → only 1 hole left,
    // less than the 3-hole minimum → no press.
    const holes = [
      holeResult(1, "push"),
      holeResult(2, "push"),
      holeResult(3, "a"),
      holeResult(4, "b"),
      holeResult(5, "push"),
      holeResult(6, "push"),
      holeResult(7, "a"),
      holeResult(8, "a"), // a-delta now +2
      holeResult(9, "push")
    ];
    expect(detectAutoPresses(holes, baseOpts)).toEqual([]);
  });

  it("only opens one press per direction at a time", () => {
    // A goes +2 at hole 2 → press opens. Holes 3-5: A keeps winning,
    // delta keeps growing — but no NEW press opens until B claws back.
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "a"), // +2 → press 1 opens (covers 3-9)
      holeResult(3, "a"), // +3 — would trigger another but same direction blocks
      holeResult(4, "a"), // +4
      holeResult(5, "push"),
      holeResult(6, "push"),
      holeResult(7, "push"),
      holeResult(8, "push"),
      holeResult(9, "push")
    ];
    const out = detectAutoPresses(holes, baseOpts);
    // Only ONE press in A's direction even though delta peaked at +4.
    expect(out).toHaveLength(1);
  });

  it("opens a press in the OPPOSITE direction once delta flips through trigger", () => {
    // A goes +2 (press 1 opens), then B goes on a 5-hole run flipping
    // delta to -3 → press 2 opens in B's direction.
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "a"), // +2 → press 1 (A direction)
      holeResult(3, "b"), // +1
      holeResult(4, "b"), // 0
      holeResult(5, "b"), // -1
      holeResult(6, "b"), // -2 — but no press opens (only 3 holes left, ≥minRemaining)
      // wait — at i=5 (hole 6), remaining = 9-6 = 3 holes left. Should trigger.
      holeResult(7, "b"), // -3
      holeResult(8, "push"),
      holeResult(9, "push")
    ];
    const out = detectAutoPresses(holes, baseOpts);
    // 2 presses: one A-direction, one B-direction.
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.trigger_delta >= 2)).toBe(true);
    expect(out.some((p) => p.trigger_delta <= -2)).toBe(true);
  });

  it("treats unscored holes as 0 contribution, doesn't trigger on incomplete data", () => {
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "pending"),
      holeResult(3, "pending"),
      holeResult(4, "pending"),
      holeResult(5, "pending"),
      holeResult(6, "pending"),
      holeResult(7, "pending"),
      holeResult(8, "pending"),
      holeResult(9, "pending")
    ];
    expect(detectAutoPresses(holes, baseOpts)).toEqual([]);
  });

  it("returns null result_delta for an opened press whose holes aren't all scored yet", () => {
    // A goes +2 at hole 2, press opens at hole 3, but only holes 3-4
    // are scored — press is unsettled.
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "a"), // +2 → press opens
      holeResult(3, "b"),
      holeResult(4, "a"),
      holeResult(5, "pending"),
      holeResult(6, "pending"),
      holeResult(7, "pending"),
      holeResult(8, "pending"),
      holeResult(9, "pending")
    ];
    const out = detectAutoPresses(holes, baseOpts);
    expect(out).toHaveLength(1);
    expect(out[0].result_delta).toBeNull();
  });

  it("respects maxPresses cap", () => {
    // Construct a deliberately oscillating sequence and cap at 1.
    const holes = [
      holeResult(1, "a"),
      holeResult(2, "a"),
      holeResult(3, "b"),
      holeResult(4, "b"),
      holeResult(5, "b"),
      holeResult(6, "a"),
      holeResult(7, "a"),
      holeResult(8, "a"),
      holeResult(9, "push")
    ];
    const out = detectAutoPresses(holes, { ...baseOpts, maxPresses: 1 });
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it("respects custom triggerDown (down-1 auto-press)", () => {
    const holes = [
      holeResult(1, "a"), // +1 → would trigger at down-1
      holeResult(2, "push"),
      holeResult(3, "push"),
      holeResult(4, "push"),
      holeResult(5, "push"),
      holeResult(6, "push"),
      holeResult(7, "push"),
      holeResult(8, "push"),
      holeResult(9, "push")
    ];
    const out = detectAutoPresses(holes, { ...baseOpts, triggerDown: 1 });
    expect(out).toHaveLength(1);
  });
});

describe("pressPotsBySide — money distribution", () => {
  const sideA = ["pa", "pb"];
  const sideB = ["pc", "pd"];

  it("returns zero for everyone when no presses settled", () => {
    const presses = [
      {
        label: "Nassau front · press 1",
        segment_label: "Nassau front",
        start_hole: 3,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 2,
        trigger_delta: 2,
        result_delta: null
      }
    ];
    const out = pressPotsBySide(presses, sideA, sideB);
    expect([...out.values()]).toEqual([0, 0, 0, 0]);
  });

  it("zero-sum: total deltas across all players equal 0", () => {
    const presses = [
      {
        label: "Nassau front · press 1",
        segment_label: "Nassau front",
        start_hole: 3,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 2,
        trigger_delta: 2,
        result_delta: -3 // B wins this press
      }
    ];
    const out = pressPotsBySide(presses, sideA, sideB);
    const total = [...out.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it("each loser pays stake; pot splits among winners with deterministic remainder", () => {
    // 1v3 press: 1 loser pays $10, pot = $10, splits 3 ways → $3.33 each
    // → first sorted winner gets the remainder cent.
    const presses = [
      {
        label: "Nassau front · press 1",
        segment_label: "Nassau front",
        start_hole: 3,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 2,
        trigger_delta: 2,
        result_delta: -1
      }
    ];
    const out = pressPotsBySide(presses, ["pa"], ["pb", "pc", "pd"]);
    expect(out.get("pa")).toBe(-1000);
    // Winners: pb, pc, pd. Sorted: pb, pc, pd. each = floor(1000/3) = 333.
    // Remainder = 1000 - 333*3 = 1. First sorted = pb.
    expect(out.get("pb")).toBe(334);
    expect(out.get("pc")).toBe(333);
    expect(out.get("pd")).toBe(333);
  });

  it("multiple settled presses sum cleanly", () => {
    const presses = [
      {
        label: "Nassau front · press 1",
        segment_label: "Nassau front",
        start_hole: 3,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 2,
        trigger_delta: 2,
        result_delta: -1 // B wins
      },
      {
        label: "Nassau front · press 2",
        segment_label: "Nassau front",
        start_hole: 6,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 5,
        trigger_delta: -2,
        result_delta: 1 // A wins
      }
    ];
    const out = pressPotsBySide(presses, sideA, sideB);
    // Press 1: A side loses; A players each -1000, B each +1000 (1v1 partner split)
    // Press 2: B side loses; B players each -1000, A each +1000
    // Net: everyone 0
    const total = [...out.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });
});

describe("settleManualPress — DB-driven press lifecycle", () => {
  const press: ManualPress = {
    id: "press-1",
    segment_label: "Nassau back",
    start_hole: 11,
    end_hole: 18,
    stake_cents: 1000,
    side_a_rp_ids: ["rp-a"],
    side_b_rp_ids: ["rp-b"]
  };

  it("settles to A-positive when A wins more holes in [start, end]", () => {
    // Holes 1-10 ignored (out of range). Holes 11-18: A wins 5, B wins 2, 1 push.
    const holes: HoleResult[] = [
      ...Array.from({ length: 10 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(11, "a"),
      holeResult(12, "a"),
      holeResult(13, "b"),
      holeResult(14, "a"),
      holeResult(15, "push"),
      holeResult(16, "a"),
      holeResult(17, "b"),
      holeResult(18, "a")
    ];
    const out = settleManualPress(press, holes);
    expect(out.start_hole).toBe(11);
    expect(out.end_hole).toBe(18);
    expect(out.result_delta).toBe(3); // A: 5, B: 2, delta = +3
    expect(out.label).toContain("manual press");
  });

  it("returns null result_delta when ANY hole in range is incomplete", () => {
    const holes: HoleResult[] = [
      ...Array.from({ length: 10 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(11, "a"),
      holeResult(12, "a"),
      holeResult(13, "b"),
      holeResult(14, "pending"), // unscored
      holeResult(15, "push"),
      holeResult(16, "a"),
      holeResult(17, "b"),
      holeResult(18, "a")
    ];
    const out = settleManualPress(press, holes);
    expect(out.result_delta).toBeNull();
  });

  it("ignores holes outside [start_hole, end_hole]", () => {
    // A wins every hole on the front 9 — should NOT count.
    const holes: HoleResult[] = [
      ...Array.from({ length: 9 }, (_, i) => holeResult(i + 1, "a")),
      ...Array.from({ length: 9 }, (_, i) => holeResult(i + 10, "push"))
    ];
    const out = settleManualPress(press, holes);
    expect(out.result_delta).toBe(0); // all pushes in range 11-18
  });

  it("zero result_delta on a halved press", () => {
    const holes: HoleResult[] = [
      ...Array.from({ length: 10 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(11, "a"),
      holeResult(12, "b"),
      holeResult(13, "push"),
      holeResult(14, "a"),
      holeResult(15, "b"),
      holeResult(16, "a"),
      holeResult(17, "b"),
      holeResult(18, "push")
    ];
    const out = settleManualPress(press, holes);
    expect(out.result_delta).toBe(0);
  });

  it("integrates with pressPotsBySide for zero-sum money distribution", () => {
    const holes: HoleResult[] = [
      ...Array.from({ length: 10 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(11, "a"),
      holeResult(12, "a"),
      holeResult(13, "a"),
      holeResult(14, "a"),
      holeResult(15, "push"),
      holeResult(16, "a"),
      holeResult(17, "a"),
      holeResult(18, "a")
    ];
    const settled = settleManualPress(press, holes);
    const pots = pressPotsBySide([settled], ["rp-a"], ["rp-b"]);
    expect(pots.get("rp-a")).toBe(1000);
    expect(pots.get("rp-b")).toBe(-1000);
    const total = [...pots.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it("works for 2v2 partner sides", () => {
    const teamPress: ManualPress = {
      ...press,
      side_a_rp_ids: ["rp-a1", "rp-a2"],
      side_b_rp_ids: ["rp-b1", "rp-b2"]
    };
    const holes: HoleResult[] = [
      ...Array.from({ length: 10 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(11, "a"),
      holeResult(12, "a"),
      holeResult(13, "b"),
      holeResult(14, "a"),
      holeResult(15, "push"),
      holeResult(16, "a"),
      holeResult(17, "b"),
      holeResult(18, "a")
    ];
    const settled = settleManualPress(teamPress, holes);
    const pots = pressPotsBySide(
      [settled],
      teamPress.side_a_rp_ids,
      teamPress.side_b_rp_ids
    );
    // Each B player loses $10. Pot = $20, splits between A1+A2 = $10 each.
    expect(pots.get("rp-a1")).toBe(1000);
    expect(pots.get("rp-a2")).toBe(1000);
    expect(pots.get("rp-b1")).toBe(-1000);
    expect(pots.get("rp-b2")).toBe(-1000);
  });

  it("two overlapping manual presses settle independently and stack zero-sum", () => {
    // Real scenario: Patrick + Ben press the back nine for $10. Three holes
    // later Patrick presses again from hole 14 for $20 because he's pulling
    // ahead. Both presses run to hole 18 and both should settle on their
    // own ranges without contaminating each other.
    const press1: ManualPress = {
      id: "press-back-nine",
      segment_label: "Nassau back",
      start_hole: 10,
      end_hole: 18,
      stake_cents: 1000,
      side_a_rp_ids: ["rp-a"],
      side_b_rp_ids: ["rp-b"]
    };
    const press2: ManualPress = {
      id: "press-late",
      segment_label: "Nassau back",
      start_hole: 14,
      end_hole: 18,
      stake_cents: 2000,
      side_a_rp_ids: ["rp-a"],
      side_b_rp_ids: ["rp-b"]
    };
    // Holes 10-18 outcome: A wins 4, B wins 2, 3 pushes → press1 delta +2.
    // Holes 14-18 subset: A wins 2, B wins 1, 2 pushes → press2 delta +1.
    const holes: HoleResult[] = [
      ...Array.from({ length: 9 }, (_, i) => holeResult(i + 1, "push")),
      holeResult(10, "a"),
      holeResult(11, "b"),
      holeResult(12, "push"),
      holeResult(13, "a"),
      holeResult(14, "a"),
      holeResult(15, "b"),
      holeResult(16, "push"),
      holeResult(17, "a"),
      holeResult(18, "push")
    ];
    const s1 = settleManualPress(press1, holes);
    const s2 = settleManualPress(press2, holes);
    expect(s1.result_delta).toBe(2);
    expect(s2.result_delta).toBe(1);
    const pots = pressPotsBySide([s1, s2], ["rp-a"], ["rp-b"]);
    // press1: A wins, B pays $10, A gets $10. press2: A wins, B pays $20,
    // A gets $20. Total: A +30, B -30. Zero-sum.
    expect(pots.get("rp-a")).toBe(3000);
    expect(pots.get("rp-b")).toBe(-3000);
    expect([...pots.values()].reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("auto-press + manual press on the same segment stack cleanly", () => {
    // Auto-press fires when A goes 2-down on the front 9. Then mid-round
    // someone opens a manual press on holes 5-9 for double the stake.
    // Both feed into the same pressPotsBySide and should compose without
    // interference.
    const segmentHoles: HoleResult[] = [
      holeResult(1, "b"),
      holeResult(2, "b"), // -2 → auto-press opens at hole 3
      holeResult(3, "a"),
      holeResult(4, "b"),
      holeResult(5, "a"),
      holeResult(6, "b"),
      holeResult(7, "a"),
      holeResult(8, "push"),
      holeResult(9, "b")
    ];
    const auto = detectAutoPresses(segmentHoles, baseOpts);
    expect(auto).toHaveLength(1);
    expect(auto[0].trigger_delta).toBe(-2);

    // Manual press: holes 5-9, $20 stake, same A vs B sides.
    const manual: ManualPress = {
      id: "manual-1",
      segment_label: "Nassau front",
      start_hole: 5,
      end_hole: 9,
      stake_cents: 2000,
      side_a_rp_ids: ["rp-a"],
      side_b_rp_ids: ["rp-b"]
    };
    const settled = settleManualPress(manual, segmentHoles);
    const pots = pressPotsBySide(
      [...auto, settled],
      ["rp-a"],
      ["rp-b"]
    );
    // Whatever the deltas are, the total must be zero-sum and each press
    // contributes its own stake to the loser pays / winner receives flow.
    expect([...pots.values()].reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("guards against malformed sides — empty side returns zero, no division-by-zero", () => {
    // A press with one side empty shouldn't blow up settlement. The
    // SECURITY DEFINER RPC rejects this on insert, but the engine must
    // also be defensive in case bad data sneaks through.
    const presses = [
      {
        label: "Nassau front · manual press",
        segment_label: "Nassau front",
        start_hole: 1,
        end_hole: 9,
        stake_cents: 1000,
        trigger_hole: 0,
        trigger_delta: 0,
        result_delta: 3
      }
    ];
    const out = pressPotsBySide(presses, ["rp-a"], []);
    // No B players → press is ignored, A gets nothing.
    expect(out.get("rp-a")).toBe(0);
  });
});
