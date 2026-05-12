import { describe, expect, it } from "vitest";
import { parseSettlementBreakdown } from "../lib/settlement-format";

describe("parseSettlementBreakdown", () => {
  it("parses a well-formed breakdown into per-side delta arrays", () => {
    const raw = [
      { game: "Nassau front", from: -500, to: 500 },
      { game: "Nassau back", from: -300, to: 0 },
      { game: "Skins", from: 200, to: 100 }
    ];
    const result = parseSettlementBreakdown(raw);
    expect(result.fromDeltas).toEqual([
      { game: "Nassau front", cents: -500 },
      { game: "Nassau back", cents: -300 },
      { game: "Skins", cents: 200 }
    ]);
    // toDeltas filters out the zero on "Nassau back"
    expect(result.toDeltas).toEqual([
      { game: "Nassau front", cents: 500 },
      { game: "Skins", cents: 100 }
    ]);
    expect(result.fromTotal).toBe(-600);
    expect(result.toTotal).toBe(600);
  });

  it("returns empty result for null/undefined", () => {
    const expected = {
      fromDeltas: [],
      toDeltas: [],
      fromTotal: 0,
      toTotal: 0
    };
    expect(parseSettlementBreakdown(null)).toEqual(expected);
    expect(parseSettlementBreakdown(undefined)).toEqual(expected);
  });

  it("returns empty result for non-arrays", () => {
    const expected = {
      fromDeltas: [],
      toDeltas: [],
      fromTotal: 0,
      toTotal: 0
    };
    expect(parseSettlementBreakdown({})).toEqual(expected);
    expect(parseSettlementBreakdown("string")).toEqual(expected);
    expect(parseSettlementBreakdown(42)).toEqual(expected);
  });

  it("returns empty result for empty array", () => {
    expect(parseSettlementBreakdown([])).toEqual({
      fromDeltas: [],
      toDeltas: [],
      fromTotal: 0,
      toTotal: 0
    });
  });

  it("skips non-object entries gracefully", () => {
    const raw = [
      { game: "Nassau", from: -500, to: 500 },
      null,
      "garbage",
      42,
      { game: "Skins", from: 100, to: -100 }
    ];
    const result = parseSettlementBreakdown(raw);
    expect(result.fromDeltas).toHaveLength(2);
    expect(result.toDeltas).toHaveLength(2);
    expect(result.fromTotal).toBe(-400);
    expect(result.toTotal).toBe(400);
  });

  it("coerces missing / non-numeric from/to to 0 (skipped by filter)", () => {
    const raw = [
      { game: "Nassau", from: -500, to: 500 },
      { game: "Broken", from: "wat" as any, to: null as any },
      { game: "Skins", from: 100, to: 100 }
    ];
    const result = parseSettlementBreakdown(raw);
    // "Broken" has no valid numbers, so it doesn't appear in either list.
    expect(result.fromDeltas.map((d) => d.game)).toEqual([
      "Nassau",
      "Skins"
    ]);
    expect(result.toDeltas.map((d) => d.game)).toEqual([
      "Nassau",
      "Skins"
    ]);
  });

  it("coerces non-finite numbers to 0", () => {
    const raw = [
      { game: "NaN", from: NaN, to: NaN },
      { game: "Inf", from: Infinity, to: -Infinity },
      { game: "Real", from: 100, to: 100 }
    ];
    const result = parseSettlementBreakdown(raw);
    expect(result.fromDeltas.map((d) => d.game)).toEqual(["Real"]);
    expect(result.toDeltas.map((d) => d.game)).toEqual(["Real"]);
    expect(result.fromTotal).toBe(100);
    expect(result.toTotal).toBe(100);
  });

  it("preserves non-string game names as empty string (no crash)", () => {
    const raw = [{ game: 123 as any, from: 100, to: -100 }];
    const result = parseSettlementBreakdown(raw);
    expect(result.fromDeltas).toEqual([{ game: "", cents: 100 }]);
    expect(result.toDeltas).toEqual([{ game: "", cents: -100 }]);
  });

  it("handles asymmetric zero deltas (one side contributes, other doesn't)", () => {
    // Common case: a per-player game (skins) where only the winner got
    // money. The loser's delta is 0 for them.
    const raw = [
      { game: "Skins", from: 0, to: 200 },
      { game: "Nassau", from: -200, to: 0 }
    ];
    const result = parseSettlementBreakdown(raw);
    expect(result.fromDeltas).toEqual([{ game: "Nassau", cents: -200 }]);
    expect(result.toDeltas).toEqual([{ game: "Skins", cents: 200 }]);
    expect(result.fromTotal).toBe(-200);
    expect(result.toTotal).toBe(200);
  });

  it("matches the 'chain transfer' detection contract", () => {
    // Common case: Dave owes a total of $12, paid $7 to Pat + $5 to Ben.
    // The flow Dave→Pat has amount_cents=700, but Dave's fromTotal
    // across the WHOLE round is -1200 (because Dave is also paying Ben).
    // The UI uses |fromTotal| !== amount_cents to detect a chain.
    const raw = [
      { game: "Nassau", from: -500, to: 500 },
      { game: "Skins", from: -700, to: 0 }
    ];
    const result = parseSettlementBreakdown(raw);
    expect(Math.abs(result.fromTotal)).toBe(1200);
    // Caller's flow.amount_cents would be 700 — chain detected.
    expect(Math.abs(result.fromTotal) !== 700).toBe(true);
  });
});
