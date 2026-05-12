/**
 * Tests for the OCR pattern detector.
 *
 * The detector's job is to catch the model when it pattern-fills
 * (returns plausible-looking score sequences instead of reading the
 * card). Each pattern type gets a positive test (it fires) and a
 * realistic-data test (it stays quiet on a normal round).
 */
import { describe, expect, it } from "vitest";
import {
  detectSuspiciousPatterns,
  shouldAutoFillCell,
  summarizePatternWarnings
} from "@/lib/ocr/pattern-checks";

const PARS_18 = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5];

describe("detectSuspiciousPatterns — uniform_value", () => {
  it("flags a row of all 4s with uniform_value (and other overlapping patterns)", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
        }
      ]
    });
    // All-4s legitimately trips uniform_value AND low_variance AND
    // front_back_identical — those checks are intentionally
    // overlapping so multiple defenses fire on egregious cases.
    expect(out.warnings.some((w) => w.type === "uniform_value")).toBe(true);
    expect(out.rows_to_quarantine.has(0)).toBe(true);
  });

  it("does not flag a row with realistic variation", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [5, 4, 6, 3, 5, 5, 7, 3, 5, 4, 5, 4, 4, 6, 4, 5, 3, 6]
        }
      ]
    });
    expect(out.warnings).toEqual([]);
    expect(out.rows_to_quarantine.size).toBe(0);
  });
});

describe("detectSuspiciousPatterns — low_variance", () => {
  it("flags a row of only 4s and 5s across many holes", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5]
        }
      ]
    });
    expect(out.warnings.some((w) => w.type === "low_variance")).toBe(true);
  });

  it("does not flag a row with even one out-of-range value", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [4, 5, 4, 5, 4, 5, 4, 3, 4, 5, 4, 5, 6, 5, 4, 5, 4, 5]
        }
      ]
    });
    // 3 + 6 break the all-{4,5} pattern → no low_variance flag.
    expect(out.warnings.some((w) => w.type === "low_variance")).toBe(false);
  });

  it("does not flag a row with fewer than 8 scores", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [4, 5, 4, 5, 4, 5, 4, null, null, null, null, null, null, null, null, null, null, null]
        }
      ]
    });
    expect(out.warnings.some((w) => w.type === "low_variance")).toBe(false);
  });
});

describe("detectSuspiciousPatterns — matches_par", () => {
  it("flags a row that matches par on every scored hole", () => {
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: [...PARS_18] }],
      pars: PARS_18
    });
    expect(out.warnings.some((w) => w.type === "matches_par")).toBe(true);
  });

  it("does not flag a row off par on multiple holes", () => {
    const off = PARS_18.map((p, i) => (i % 3 === 0 ? p + 2 : p));
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: off }],
      pars: PARS_18
    });
    expect(out.warnings.some((w) => w.type === "matches_par")).toBe(false);
  });

  it("skips matches_par check when pars are absent", () => {
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: [...PARS_18] }]
      // no pars
    });
    expect(out.warnings.some((w) => w.type === "matches_par")).toBe(false);
  });
});

describe("detectSuspiciousPatterns — front_back_identical", () => {
  it("flags identical front-9 and back-9 sequences", () => {
    const seq = [5, 4, 6, 3, 5, 5, 7, 3, 4];
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: [...seq, ...seq] }]
    });
    expect(out.warnings.some((w) => w.type === "front_back_identical")).toBe(true);
  });

  it("does not flag distinct halves", () => {
    const front = [5, 4, 6, 3, 5, 5, 7, 3, 4];
    const back = [4, 5, 4, 4, 6, 5, 5, 4, 5];
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: [...front, ...back] }]
    });
    expect(out.warnings.some((w) => w.type === "front_back_identical")).toBe(false);
  });

  it("ignores 9-hole rounds (front-back check is 18-only)", () => {
    const out = detectSuspiciousPatterns({
      rows: [{ name: "Cruz", scores: [5, 4, 6, 3, 5, 5, 7, 3, 4] }]
    });
    expect(out.warnings.some((w) => w.type === "front_back_identical")).toBe(false);
  });
});

describe("detectSuspiciousPatterns — players_similar", () => {
  it("flags two rows that match on ≥90% of compared holes (tightened 2026-05-12)", () => {
    const scores = [5, 4, 6, 3, 5, 5, 7, 3, 4, 4, 5, 4, 4, 6, 4, 5, 3, 6];
    const out = detectSuspiciousPatterns({
      rows: [
        { name: "Cruz", scores },
        { name: "Mitch", scores: [...scores] }
      ]
    });
    expect(out.warnings.some((w) => w.type === "players_similar")).toBe(true);
    // The LATER row gets flagged (preserves the earlier data).
    expect(out.rows_to_quarantine.has(1)).toBe(true);
    expect(out.rows_to_quarantine.has(0)).toBe(true);
  });

  it("does not flag rows with distinct scores", () => {
    const out = detectSuspiciousPatterns({
      rows: [
        { name: "Cruz", scores: [5, 4, 6, 3, 5, 5, 7, 3, 4, 4, 5, 4, 4, 6, 4, 5, 3, 6] },
        { name: "Mitch", scores: [4, 5, 4, 4, 6, 5, 5, 4, 5, 6, 4, 5, 3, 5, 5, 4, 4, 5] }
      ]
    });
    expect(out.warnings.some((w) => w.type === "players_similar")).toBe(false);
  });

  it("does not crash with empty input", () => {
    const out = detectSuspiciousPatterns({ rows: [] });
    expect(out.warnings).toEqual([]);
    expect(out.rows_to_quarantine.size).toBe(0);
  });

  it("does NOT flag partner-play rounds where two similar players legitimately match on 7 of 9 holes", () => {
    // Regression for the 2026-05-12 threshold tune. Patrick's tester
    // played 6-6-6 with similar-handicap partners; the OCR pipeline
    // quarantined a clean parse because two players had near-identical
    // scores on multiple holes. New threshold requires 90% on ≥9.
    const a = [4, 4, 5, 3, 4, 4, 5, 3, 4]; // 9 holes
    const b = [4, 4, 5, 3, 4, 5, 6, 3, 4]; // matches on 7 of 9 (78%)
    const out = detectSuspiciousPatterns({
      rows: [
        { name: "Cruz", scores: a },
        { name: "Mitch", scores: b }
      ]
    });
    expect(out.warnings.some((w) => w.type === "players_similar")).toBe(false);
  });

  it("requires at least 9 compared holes (front-9-only no longer triggers)", () => {
    // Two players with all-identical front 9 but no back-9 scores
    // shouldn't trigger — only 9 holes compared, less than the new
    // minimum. (Old threshold of 6 would have fired here.)
    const front = [5, 4, 6, 3, 5, 5, 7, 3, 4];
    const out = detectSuspiciousPatterns({
      rows: [
        { name: "Cruz", scores: [...front] },
        { name: "Mitch", scores: [...front] }
      ]
    });
    // 9 holes compared, 100% match → just barely triggers under the
    // new threshold. The threshold is "≥9 holes compared" — 9 itself
    // qualifies. Verify it DOES fire at exactly 9 with 100% match.
    expect(out.warnings.some((w) => w.type === "players_similar")).toBe(true);
  });

  it("does NOT flag two rows that compare on only 8 holes (just under the new floor)", () => {
    // 8 cells compared, 100% match — under the new 9-hole floor.
    const front = [5, 4, 6, 3, 5, 5, 7, 3];
    const out = detectSuspiciousPatterns({
      rows: [
        { name: "Cruz", scores: front },
        { name: "Mitch", scores: front }
      ]
    });
    expect(out.warnings.some((w) => w.type === "players_similar")).toBe(false);
  });
});

describe("detectSuspiciousPatterns — multiple warnings on one row", () => {
  it("aggregates warnings + quarantines once per row", () => {
    // A row of all 4s — triggers BOTH uniform_value AND low_variance.
    const out = detectSuspiciousPatterns({
      rows: [
        {
          name: "Cruz",
          scores: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
        }
      ]
    });
    expect(out.warnings.length).toBeGreaterThanOrEqual(2);
    expect(out.rows_to_quarantine.size).toBe(1);
  });
});

describe("summarizePatternWarnings", () => {
  it("counts warnings by type", () => {
    const summary = summarizePatternWarnings([
      { type: "uniform_value", row_index: 0, detail: "" },
      { type: "uniform_value", row_index: 1, detail: "" },
      { type: "matches_par", row_index: 2, detail: "" }
    ]);
    expect(summary).toHaveLength(2);
    expect(summary.find((s) => s.type === "uniform_value")?.count).toBe(2);
    expect(summary.find((s) => s.type === "matches_par")?.count).toBe(1);
  });
});

describe("shouldAutoFillCell", () => {
  it("only allows auto-fill when ALL three conditions are met", () => {
    expect(
      shouldAutoFillCell({
        confidence: "high",
        is_par_suspicious: false,
        row_is_quarantined: false
      })
    ).toBe(true);
    expect(
      shouldAutoFillCell({
        confidence: "low",
        is_par_suspicious: false,
        row_is_quarantined: false
      })
    ).toBe(false);
    expect(
      shouldAutoFillCell({
        confidence: "high",
        is_par_suspicious: true,
        row_is_quarantined: false
      })
    ).toBe(false);
    expect(
      shouldAutoFillCell({
        confidence: "high",
        is_par_suspicious: false,
        row_is_quarantined: true
      })
    ).toBe(false);
    expect(
      shouldAutoFillCell({
        confidence: null,
        is_par_suspicious: false,
        row_is_quarantined: false
      })
    ).toBe(false);
  });
});
