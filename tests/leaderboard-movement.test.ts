/**
 * Tests for the leaderboard movement-indicator helpers.
 *
 * These guard the diff semantics (4 → 2 = +2 "up", not -2) and the
 * expiry / merge behavior that the React hook in Leaderboard.tsx
 * composes them with.
 */
import { describe, expect, it } from "vitest";
import {
  diffPositions,
  expireMovements,
  fmtMovement,
  mergeMovements,
  rankWithTies,
  type MovementDelta
} from "@/lib/leaderboard-movement";

describe("diffPositions", () => {
  it("returns positive delta when a player moves UP the board (lower number)", () => {
    const prev = new Map([["rp-a", 4], ["rp-b", 3]]);
    const next = new Map([["rp-a", 2], ["rp-b", 3]]);
    const out = diffPositions(prev, next, 1000);
    expect(out.get("rp-a")).toEqual({ delta: 2, observed_at: 1000 });
    expect(out.has("rp-b")).toBe(false);
  });

  it("returns negative delta when a player moves DOWN the board (higher number)", () => {
    const prev = new Map([["rp-a", 2]]);
    const next = new Map([["rp-a", 4]]);
    const out = diffPositions(prev, next, 5000);
    expect(out.get("rp-a")).toEqual({ delta: -2, observed_at: 5000 });
  });

  it("ignores rp_ids that didn't exist in the prior snapshot — no false-positive on first appearance", () => {
    const prev = new Map([["rp-a", 1]]);
    const next = new Map([
      ["rp-a", 2],
      ["rp-newcomer", 1]
    ]);
    const out = diffPositions(prev, next, 0);
    expect(out.has("rp-a")).toBe(true);
    expect(out.has("rp-newcomer")).toBe(false);
  });

  it("ignores rp_ids whose position didn't change", () => {
    const prev = new Map([["rp-a", 3]]);
    const next = new Map([["rp-a", 3]]);
    const out = diffPositions(prev, next, 0);
    expect(out.size).toBe(0);
  });

  it("returns an empty map when nothing changed at all", () => {
    const prev = new Map([["rp-a", 1], ["rp-b", 2]]);
    const next = new Map(prev);
    const out = diffPositions(prev, next, 1234);
    expect(out.size).toBe(0);
  });

  it("handles a full leaderboard shake-up correctly", () => {
    // Before: 1=A, 2=B, 3=C, 4=D
    // After:  1=D, 2=A, 3=B, 4=C
    // Movement (signed, up=positive):
    //   A: 1 → 2 = -1 (down)
    //   B: 2 → 3 = -1 (down)
    //   C: 3 → 4 = -1 (down)
    //   D: 4 → 1 = +3 (up)
    const prev = new Map([
      ["rp-a", 1],
      ["rp-b", 2],
      ["rp-c", 3],
      ["rp-d", 4]
    ]);
    const next = new Map([
      ["rp-d", 1],
      ["rp-a", 2],
      ["rp-b", 3],
      ["rp-c", 4]
    ]);
    const out = diffPositions(prev, next, 100);
    expect(out.get("rp-a")?.delta).toBe(-1);
    expect(out.get("rp-b")?.delta).toBe(-1);
    expect(out.get("rp-c")?.delta).toBe(-1);
    expect(out.get("rp-d")?.delta).toBe(3);
  });
});

describe("expireMovements", () => {
  const ttl = 6000;

  it("drops entries older than TTL", () => {
    const movements = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 1000 }],
      ["rp-b", { delta: -1, observed_at: 9000 }]
    ]);
    const out = expireMovements(movements, 8000, ttl); // 8000 - 1000 = 7000 > 6000, drop A
    expect(out.has("rp-a")).toBe(false);
    expect(out.get("rp-b")?.delta).toBe(-1);
  });

  it("returns the SAME reference when nothing expired (lets React skip re-renders)", () => {
    const movements = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 4000 }]
    ]);
    const out = expireMovements(movements, 5000, ttl);
    expect(out).toBe(movements);
  });

  it("returns a NEW reference when something expired", () => {
    const movements = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 1000 }]
    ]);
    const out = expireMovements(movements, 10000, ttl);
    expect(out).not.toBe(movements);
    expect(out.size).toBe(0);
  });

  it("returns empty when all entries expired", () => {
    const movements = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 0 }],
      ["rp-b", { delta: -2, observed_at: 0 }]
    ]);
    const out = expireMovements(movements, 100_000, ttl);
    expect(out.size).toBe(0);
  });
});

describe("mergeMovements", () => {
  it("returns the base map when incoming is empty (reference equality)", () => {
    const base = new Map<string, MovementDelta>([["rp-a", { delta: 1, observed_at: 0 }]]);
    const incoming = new Map<string, MovementDelta>();
    expect(mergeMovements(base, incoming)).toBe(base);
  });

  it("overwrites older deltas with newer ones for the same rp_id", () => {
    const base = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 1000 }]
    ]);
    const incoming = new Map<string, MovementDelta>([
      ["rp-a", { delta: -2, observed_at: 5000 }]
    ]);
    const out = mergeMovements(base, incoming);
    expect(out.get("rp-a")).toEqual({ delta: -2, observed_at: 5000 });
  });

  it("preserves entries not in the incoming set", () => {
    const base = new Map<string, MovementDelta>([
      ["rp-a", { delta: 1, observed_at: 1000 }],
      ["rp-b", { delta: 2, observed_at: 2000 }]
    ]);
    const incoming = new Map<string, MovementDelta>([
      ["rp-c", { delta: 3, observed_at: 3000 }]
    ]);
    const out = mergeMovements(base, incoming);
    expect(out.size).toBe(3);
    expect(out.get("rp-a")?.delta).toBe(1);
    expect(out.get("rp-b")?.delta).toBe(2);
    expect(out.get("rp-c")?.delta).toBe(3);
  });
});

describe("rankWithTies", () => {
  it("assigns 1, 2, 3, ... when no ties", () => {
    const sorted = [-3, -1, 0, 2];
    const out = rankWithTies(sorted, (n) => n);
    expect(out.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(out.every((r) => r.tied === false)).toBe(true);
  });

  it("shares the position among tied entries; next entry skips ahead", () => {
    // -3, -3, -1, 0, 0, +1
    // Expected: T1, T1, 3, T4, T4, 6
    const sorted = [-3, -3, -1, 0, 0, 1];
    const out = rankWithTies(sorted, (n) => n);
    expect(out.map((r) => r.position)).toEqual([1, 1, 3, 4, 4, 6]);
    expect(out.map((r) => r.tied)).toEqual([true, true, false, true, true, false]);
  });

  it("handles a 3-way tie at the top", () => {
    // 0, 0, 0, 1, 1, 5
    // Expected: T1, T1, T1, T4, T4, 6
    const sorted = [0, 0, 0, 1, 1, 5];
    const out = rankWithTies(sorted, (n) => n);
    expect(out.map((r) => r.position)).toEqual([1, 1, 1, 4, 4, 6]);
    expect(out.map((r) => r.tied)).toEqual([true, true, true, true, true, false]);
  });

  it("handles an empty array", () => {
    const out = rankWithTies([], (n: number) => n);
    expect(out).toEqual([]);
  });

  it("handles a single entry (not tied)", () => {
    const out = rankWithTies([5], (n) => n);
    expect(out).toEqual([{ position: 1, tied: false }]);
  });

  it("uses keyFn to compare — objects work", () => {
    const players = [
      { id: "a", score: -2 },
      { id: "b", score: -2 },
      { id: "c", score: 0 }
    ];
    const out = rankWithTies(players, (p) => p.score);
    expect(out.map((r) => r.position)).toEqual([1, 1, 3]);
    expect(out.map((r) => r.tied)).toEqual([true, true, false]);
  });
});

describe("fmtMovement", () => {
  it("renders positive as ↑n", () => {
    expect(fmtMovement(2)).toBe("↑2");
    expect(fmtMovement(1)).toBe("↑1");
    expect(fmtMovement(10)).toBe("↑10");
  });
  it("renders negative as ↓n (no sign on the digit)", () => {
    expect(fmtMovement(-1)).toBe("↓1");
    expect(fmtMovement(-3)).toBe("↓3");
  });
  it("renders zero as empty string (callers guard but this is safe)", () => {
    expect(fmtMovement(0)).toBe("");
  });
});
