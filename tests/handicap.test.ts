import { describe, expect, it } from "vitest";
import {
  STANDARD_SLOPE,
  applyCap,
  courseHandicap,
  netForHole,
  playingHandicap,
  strokesPerHole
} from "@/lib/handicap";

describe("courseHandicap", () => {
  it("worked example: HI 14.2 / Slope 132 / Rating 71.2 / Par 72 -> 16", () => {
    expect(courseHandicap(14.2, 132, 71.2, 72)).toBe(16);
  });
  it("formula uses slope/113 + rating-par with half-up rounding", () => {
    const ch = courseHandicap(0, 113, 72, 72);
    expect(ch).toBe(0);
  });
  it("rating below par gives back strokes", () => {
    // HI 10, slope 113, rating 70, par 72 -> 10 + (-2) = 8
    expect(courseHandicap(10, 113, 70, 72)).toBe(8);
  });
  it("plus handicaps survive", () => {
    // HI -1.5, slope 113, rating 72, par 72 -> -1.5 -> rounds to -1
    expect(courseHandicap(-1.5, 113, 72, 72)).toBe(-1);
  });
  it("9-hole halves the index", () => {
    expect(courseHandicap(14, 132, 35.6, 36, 9)).toBe(courseHandicap(7, 132, 35.6, 36, 18));
  });
  it("STANDARD_SLOPE is 113", () => {
    expect(STANDARD_SLOPE).toBe(113);
  });
});

describe("playingHandicap", () => {
  it("100% allowance is identity", () => {
    expect(playingHandicap(16, 100)).toBe(16);
  });
  it("95% applies and rounds half-up", () => {
    expect(playingHandicap(16, 95)).toBe(15); // 15.2 -> 15
    expect(playingHandicap(20, 95)).toBe(19); // 19.0
    expect(playingHandicap(7, 85)).toBe(6);   // 5.95 -> 6
  });
});

describe("strokesPerHole", () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1,
    stroke_index: i + 1
  }));
  it("playingHc 0 -> all zeros", () => {
    const s = strokesPerHole(0, holes);
    expect(s).toEqual(new Array(18).fill(0));
  });
  it("playingHc 5 -> SI 1..5 each get 1, rest 0", () => {
    const s = strokesPerHole(5, holes);
    const ones = s.filter((x) => x === 1).length;
    expect(ones).toBe(5);
    expect(s.reduce((a, b) => a + b, 0)).toBe(5);
  });
  it("playingHc 18 -> all ones", () => {
    const s = strokesPerHole(18, holes);
    expect(s.every((x) => x === 1)).toBe(true);
  });
  it("playingHc 22 -> SI 1..4 get 2, rest 1", () => {
    const s = strokesPerHole(22, holes);
    expect(s.reduce((a, b) => a + b, 0)).toBe(22);
    expect(s.filter((x) => x === 2).length).toBe(4);
    expect(s.filter((x) => x === 1).length).toBe(14);
  });
  it("plus handicap -2 -> SI 17,18 get -1 each", () => {
    const s = strokesPerHole(-2, holes);
    expect(s.reduce((a, b) => a + b, 0)).toBe(-2);
    expect(s[17]).toBe(-1);
    expect(s[16]).toBe(-1);
  });
});

describe("net & cap", () => {
  it("netForHole subtracts strokes", () => {
    expect(netForHole(6, 1)).toBe(5);
  });
  it("none mode returns gross", () => {
    expect(applyCap(9, 4, 0, "none")).toBe(9);
  });
  it("double_bogey_plus caps at par + 2 + strokes", () => {
    expect(applyCap(9, 4, 1, "double_bogey_plus")).toBe(7);
    expect(applyCap(5, 4, 1, "double_bogey_plus")).toBe(5);
  });
  it("triple_bogey caps at par + 3 + strokes", () => {
    expect(applyCap(10, 4, 0, "triple_bogey")).toBe(7);
  });
});
