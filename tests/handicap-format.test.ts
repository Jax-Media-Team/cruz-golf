import { describe, expect, it } from "vitest";
import { formatHi, hiInputValue, parseHi } from "@/lib/handicap-format";

describe("formatHi (display)", () => {
  it("renders null/undefined as em-dash", () => {
    expect(formatHi(null)).toBe("—");
    expect(formatHi(undefined)).toBe("—");
    expect(formatHi(NaN)).toBe("—");
  });
  it("renders scratch as 0.0", () => {
    expect(formatHi(0)).toBe("0.0");
  });
  it("renders positive index with one decimal", () => {
    expect(formatHi(14)).toBe("14.0");
    expect(formatHi(8.3)).toBe("8.3");
  });
  it("renders plus index with leading + and absolute value", () => {
    expect(formatHi(-1.4)).toBe("+1.4");
    expect(formatHi(-2)).toBe("+2.0");
    expect(formatHi(-0.5)).toBe("+0.5");
  });
});

describe("parseHi (input)", () => {
  it("returns null for empty / whitespace", () => {
    expect(parseHi("")).toBe(null);
    expect(parseHi("   ")).toBe(null);
  });
  it("parses plain numbers", () => {
    expect(parseHi("14")).toBe(14);
    expect(parseHi("14.0")).toBe(14);
    expect(parseHi("8.3")).toBe(8.3);
    expect(parseHi("0")).toBe(0);
  });
  it("converts +N to negative (plus index)", () => {
    expect(parseHi("+1.4")).toBe(-1.4);
    expect(parseHi("+0.5")).toBe(-0.5);
    expect(parseHi("+2")).toBe(-2);
  });
  it("accepts -N as already-negative input", () => {
    expect(parseHi("-1.4")).toBe(-1.4);
  });
  it("returns null for garbage", () => {
    expect(parseHi("abc")).toBe(null);
    expect(parseHi("+abc")).toBe(null);
  });
});

describe("hiInputValue (round-trip)", () => {
  it("renders empty for null", () => {
    expect(hiInputValue(null)).toBe("");
    expect(hiInputValue(undefined)).toBe("");
  });
  it("renders positive as a plain number", () => {
    expect(hiInputValue(14)).toBe("14");
    expect(hiInputValue(8.3)).toBe("8.3");
  });
  it("renders plus index with + prefix", () => {
    expect(hiInputValue(-1.4)).toBe("+1.4");
    expect(hiInputValue(-2)).toBe("+2");
  });
  it("round-trips through parseHi", () => {
    const cases: (number | null)[] = [null, 0, 14, 8.3, -1.4, -0.5];
    for (const n of cases) {
      expect(parseHi(hiInputValue(n))).toBe(n);
    }
  });
});
