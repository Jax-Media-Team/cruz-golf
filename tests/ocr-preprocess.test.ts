/**
 * Tests for the pure dimension-math helper used by the OCR image
 * preprocessor. The canvas / createImageBitmap path isn't tested
 * here — those are browser APIs that vitest's node environment
 * can't realistically simulate without a heavy DOM mock. The math
 * helper covers the only branching logic that matters for the
 * "scale or pass through" decision.
 */
import { describe, expect, it } from "vitest";
import { computeOcrTargetDimensions } from "@/lib/ocr/preprocess";

describe("computeOcrTargetDimensions", () => {
  it("passes through unchanged when long side is within the cap", () => {
    expect(computeOcrTargetDimensions(1920, 1080)).toEqual({
      w: 1920,
      h: 1080,
      scaled: false
    });
    expect(computeOcrTargetDimensions(2400, 1200)).toEqual({
      w: 2400,
      h: 1200,
      scaled: false
    });
  });

  it("scales down landscape images to maxLongSide on the wider edge", () => {
    // 4032x3024 (iPhone default) → 2400 long side
    const out = computeOcrTargetDimensions(4032, 3024);
    expect(out.scaled).toBe(true);
    expect(out.w).toBe(2400);
    // Preserve aspect ratio: 3024 * (2400/4032) = 1800
    expect(out.h).toBe(1800);
  });

  it("scales down portrait images to maxLongSide on the taller edge", () => {
    const out = computeOcrTargetDimensions(3024, 4032);
    expect(out.scaled).toBe(true);
    expect(out.h).toBe(2400);
    expect(out.w).toBe(1800);
  });

  it("handles a square source", () => {
    const out = computeOcrTargetDimensions(4000, 4000);
    expect(out.scaled).toBe(true);
    expect(out.w).toBe(2400);
    expect(out.h).toBe(2400);
  });

  it("respects a custom maxLongSide", () => {
    const out = computeOcrTargetDimensions(4032, 3024, 1600);
    expect(out.scaled).toBe(true);
    expect(out.w).toBe(1600);
    expect(out.h).toBe(1200);
  });

  it("returns zeros on zero / negative input (defensive)", () => {
    expect(computeOcrTargetDimensions(0, 100)).toEqual({
      w: 0,
      h: 0,
      scaled: false
    });
    expect(computeOcrTargetDimensions(100, 0)).toEqual({
      w: 0,
      h: 0,
      scaled: false
    });
    expect(computeOcrTargetDimensions(-1, 100)).toEqual({
      w: 0,
      h: 0,
      scaled: false
    });
  });

  it("rounds to integer pixels — no fractional canvas dimensions", () => {
    // 3000 * (2400/3001) = 2399.2002... should round to 2399
    const out = computeOcrTargetDimensions(3001, 3000);
    expect(Number.isInteger(out.w)).toBe(true);
    expect(Number.isInteger(out.h)).toBe(true);
  });
});
