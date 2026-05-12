/**
 * Pure-helper tests for the OCR image transforms.
 *
 * The canvas / drawImage parts can't be tested under vitest's node
 * environment, but the dimension + crop math can be exercised
 * directly. These tests guard the geometry — a rotated landscape
 * card becomes portrait, a 50% crop of a 2400x1800 image is
 * 1200x900, etc.
 */
import { describe, expect, it } from "vitest";
import { rotatedDimensions, cropPixelBounds } from "@/lib/ocr/transform";

describe("rotatedDimensions — 90°-multiple geometry", () => {
  it("0 turns: dimensions unchanged", () => {
    expect(rotatedDimensions(2400, 1800, 0)).toEqual({ w: 2400, h: 1800 });
  });
  it("1 turn (90° CW): swaps width/height", () => {
    expect(rotatedDimensions(2400, 1800, 1)).toEqual({ w: 1800, h: 2400 });
  });
  it("2 turns (180°): unchanged", () => {
    expect(rotatedDimensions(2400, 1800, 2)).toEqual({ w: 2400, h: 1800 });
  });
  it("3 turns (270° CW = 90° CCW): swaps width/height", () => {
    expect(rotatedDimensions(2400, 1800, 3)).toEqual({ w: 1800, h: 2400 });
  });
  it("wraps around (4 = 0, 5 = 1, ...)", () => {
    expect(rotatedDimensions(2400, 1800, 4)).toEqual({ w: 2400, h: 1800 });
    expect(rotatedDimensions(2400, 1800, 5)).toEqual({ w: 1800, h: 2400 });
    expect(rotatedDimensions(2400, 1800, 8)).toEqual({ w: 2400, h: 1800 });
  });
  it("handles negative turns (counter-clockwise)", () => {
    expect(rotatedDimensions(2400, 1800, -1)).toEqual({ w: 1800, h: 2400 });
    expect(rotatedDimensions(2400, 1800, -4)).toEqual({ w: 2400, h: 1800 });
  });
});

describe("cropPixelBounds — normalized [0,1] crop to pixel rect", () => {
  it("identity crop returns the whole source", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: 0, y: 0, w: 1, h: 1 })
    ).toEqual({ sx: 0, sy: 0, sw: 2400, sh: 1800 });
  });
  it("crops to the bottom half", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: 0, y: 0.5, w: 1, h: 0.5 })
    ).toEqual({ sx: 0, sy: 900, sw: 2400, sh: 900 });
  });
  it("crops to the right half (back-9 on a landscape card)", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: 0.5, y: 0, w: 0.5, h: 1 })
    ).toEqual({ sx: 1200, sy: 0, sw: 1200, sh: 1800 });
  });
  it("clamps to bounds when over-spec'd", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: 0.8, y: 0, w: 0.5, h: 1 })
    ).toEqual({ sx: 1920, sy: 0, sw: 480, sh: 1800 });
  });
  it("clamps negative offsets to 0", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: -0.2, y: -0.1, w: 0.5, h: 0.5 })
    ).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 900 });
  });
  it("returns the whole source on a degenerate (zero-area) crop", () => {
    expect(
      cropPixelBounds({ w: 2400, h: 1800 }, { x: 0.5, y: 0.5, w: 0, h: 0 })
    ).toEqual({ sx: 0, sy: 0, sw: 2400, sh: 1800 });
  });
  it("rounds to integer pixels", () => {
    const out = cropPixelBounds(
      { w: 2401, h: 1801 },
      { x: 0.3333, y: 0.6667, w: 0.5, h: 0.25 }
    );
    expect(Number.isInteger(out.sx)).toBe(true);
    expect(Number.isInteger(out.sy)).toBe(true);
    expect(Number.isInteger(out.sw)).toBe(true);
    expect(Number.isInteger(out.sh)).toBe(true);
  });
});
