import { describe, expect, it } from "vitest";
import {
  deserialize,
  dropHead,
  enqueueOrReplace,
  makeKey,
  serialize,
  type PendingItem
} from "@/lib/score-queue";

const item = (rp: string, hole: number, gross: number, ts = 0): PendingItem => ({
  key: makeKey(rp, hole),
  round_player_id: rp,
  hole_number: hole,
  gross,
  attempts: 0,
  enqueuedAt: ts
});

describe("score-queue: enqueueOrReplace", () => {
  it("appends a new item to an empty queue", () => {
    const out = enqueueOrReplace([], item("p-1", 3, 4));
    expect(out).toHaveLength(1);
    expect(out[0].gross).toBe(4);
  });

  it("replaces a prior item for the same player+hole (newest wins)", () => {
    const start = [item("p-1", 3, 4, 1), item("p-2", 3, 5, 2)];
    const out = enqueueOrReplace(start, item("p-1", 3, 6, 3));
    expect(out).toHaveLength(2);
    // p-1 hole 3 should now be the LAST entry, with the new gross.
    expect(out[out.length - 1]).toMatchObject({ round_player_id: "p-1", hole_number: 3, gross: 6 });
    // p-2 should remain.
    expect(out.find((x) => x.round_player_id === "p-2")).toBeDefined();
  });

  it("preserves order for unrelated entries", () => {
    const a = item("p-1", 1, 4, 1);
    const b = item("p-1", 2, 5, 2);
    const c = item("p-2", 1, 3, 3);
    const out = enqueueOrReplace([a, b, c], item("p-3", 1, 5, 4));
    expect(out.map((x) => x.round_player_id)).toEqual(["p-1", "p-1", "p-2", "p-3"]);
  });
});

describe("score-queue: dropHead", () => {
  it("returns an empty array when given empty", () => {
    expect(dropHead([])).toEqual([]);
  });
  it("removes only the first item", () => {
    const q = [item("a", 1, 4), item("b", 2, 5), item("c", 3, 6)];
    expect(dropHead(q).map((x) => x.round_player_id)).toEqual(["b", "c"]);
  });
});

describe("score-queue: serialize / deserialize", () => {
  it("round-trips a queue", () => {
    const q = [item("p-1", 3, 4, 1234), item("p-2", 4, 5, 5678)];
    expect(deserialize(serialize(q))).toEqual(q);
  });
  it("returns empty for null / empty / garbage", () => {
    expect(deserialize(null)).toEqual([]);
    expect(deserialize("")).toEqual([]);
    expect(deserialize("not json")).toEqual([]);
    expect(deserialize("123")).toEqual([]);
    expect(deserialize("{}")).toEqual([]);
  });
  it("filters out malformed items", () => {
    const mixed = JSON.stringify([
      item("p-1", 3, 4, 1),
      { key: "x", round_player_id: 5 /* wrong type */ },
      item("p-2", 4, 5, 2)
    ]);
    const out = deserialize(mixed);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.round_player_id)).toEqual(["p-1", "p-2"]);
  });
  it("survives v1 -> future-version migration via unknown fields", () => {
    // Items with extra unknown keys are preserved (we only validate required).
    const raw = JSON.stringify([{ ...item("p-1", 3, 4, 1), futureField: "ok" }]);
    expect(deserialize(raw)).toHaveLength(1);
  });
});

describe("score-queue: makeKey", () => {
  it("produces a stable round_player_id:hole_number key", () => {
    expect(makeKey("rp-abc", 7)).toBe("rp-abc:7");
  });
});
