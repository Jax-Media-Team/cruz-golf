import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatShortDate,
  formatRoundDate,
  formatLongRoundDate
} from "../lib/format-date";

describe("formatRoundDate", () => {
  it("renders a pure-date string as 'Mon D, YYYY'", () => {
    expect(formatRoundDate("2026-05-12")).toBe("May 12, 2026");
    expect(formatRoundDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatRoundDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("does NOT shift the date across TZ boundaries", () => {
    // Regression: parsing YYYY-MM-DD as local midnight then converting to
    // Eastern would push the date BACK a day for users east of UTC.
    // formatRoundDate parses at noon UTC and formats with timeZone "UTC"
    // to keep the same day-of-month regardless of host TZ.
    expect(formatRoundDate("2026-05-12")).toMatch(/May 12/);
    // Year boundary — most prone to TZ-shift bugs.
    expect(formatRoundDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatRoundDate("2025-12-31")).toBe("Dec 31, 2025");
  });

  it("returns '' for null/undefined/empty", () => {
    expect(formatRoundDate(null)).toBe("");
    expect(formatRoundDate(undefined)).toBe("");
    expect(formatRoundDate("")).toBe("");
  });

  it("delegates non-YYYY-MM-DD strings to formatDate (TZ-shifted)", () => {
    // An ISO timestamp with a time component goes through the timezone-
    // aware path. We don't assert exact output here because it depends on
    // the system clock + TZ, but it should NOT throw and should produce
    // a non-empty formatted string.
    expect(formatRoundDate(new Date("2026-05-12T15:00:00Z"))).not.toBe("");
  });
});

describe("formatShortDate", () => {
  it("renders 'Mon D' style", () => {
    expect(formatShortDate("2026-05-12")).toBe("May 12");
    expect(formatShortDate("2026-01-01")).toBe("Jan 1");
  });

  it("is TZ-stable on year boundaries", () => {
    expect(formatShortDate("2026-01-01")).toBe("Jan 1");
    expect(formatShortDate("2025-12-31")).toBe("Dec 31");
  });

  it("returns '' for null/empty", () => {
    expect(formatShortDate(null)).toBe("");
    expect(formatShortDate("")).toBe("");
  });
});

describe("formatLongRoundDate", () => {
  it("renders 'Weekday, Month D'", () => {
    // 2026-05-12 is a Tuesday.
    expect(formatLongRoundDate("2026-05-12")).toBe("Tuesday, May 12");
  });

  it("renders weekday correctly across the week", () => {
    // 2026-05-09 = Saturday, 2026-05-10 = Sunday
    expect(formatLongRoundDate("2026-05-09")).toBe("Saturday, May 9");
    expect(formatLongRoundDate("2026-05-10")).toBe("Sunday, May 10");
  });

  it("is TZ-stable on year boundaries", () => {
    // 2026-01-01 = Thursday
    expect(formatLongRoundDate("2026-01-01")).toBe("Thursday, January 1");
  });

  it("returns '' for null/empty", () => {
    expect(formatLongRoundDate(null)).toBe("");
    expect(formatLongRoundDate("")).toBe("");
  });
});

describe("formatDate (timezone-aware path)", () => {
  it("does NOT throw on null/undefined/invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("not a date")).toBe("");
    expect(formatDate(NaN)).toBe("");
  });

  it("handles Date instances + ISO strings + epoch numbers", () => {
    const d = new Date("2026-05-12T15:30:00Z");
    const ts = d.getTime();
    expect(formatDate(d)).not.toBe("");
    expect(formatDate(d.toISOString())).not.toBe("");
    expect(formatDate(ts)).not.toBe("");
  });
});

describe("formatDateTime", () => {
  it("includes hour + minute + timezone abbreviation", () => {
    const d = new Date("2026-05-12T15:30:00Z");
    const out = formatDateTime(d);
    expect(out).not.toBe("");
    // Should contain a colon (HH:MM format) and a TZ abbreviation.
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    expect(out).toMatch(/[A-Z]{2,4}/); // EST/EDT/PST/etc.
  });

  it("returns '' for invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("garbage")).toBe("");
  });
});
