import { describe, it, expect } from "vitest";
import {
  detectAutoPresses,
  pressPotsBySide,
  type HoleResult,
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
