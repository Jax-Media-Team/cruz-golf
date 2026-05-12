import { describe, expect, it } from "vitest";
import {
  cleanHandle,
  cleanUrl,
  venmoPayUrl,
  venmoNoteForRound
} from "../lib/profile-format";

describe("cleanHandle", () => {
  it("strips a single leading @", () => {
    expect(cleanHandle("@cruzgolfer")).toBe("cruzgolfer");
  });

  it("strips surrounding whitespace", () => {
    expect(cleanHandle("  cruzgolfer  ")).toBe("cruzgolfer");
    expect(cleanHandle("\t@cruzgolfer\n")).toBe("cruzgolfer");
  });

  it("returns null for empty input", () => {
    expect(cleanHandle("")).toBeNull();
    expect(cleanHandle("   ")).toBeNull();
    expect(cleanHandle("@")).toBeNull();
    expect(cleanHandle(" @ ")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(cleanHandle(null)).toBeNull();
    expect(cleanHandle(undefined)).toBeNull();
  });

  it("keeps internal @ symbols (email-like input)", () => {
    // Defensive: a user pasting "patrick@cruz.com" is feeding the wrong
    // field but we don't silently strip beyond the FIRST leading @.
    expect(cleanHandle("@patrick@cruz.com")).toBe("patrick@cruz.com");
  });

  it("is idempotent", () => {
    const inputs = ["@cruzgolfer", "  patrick  ", "@@@stacked"];
    for (const x of inputs) {
      const once = cleanHandle(x);
      const twice = cleanHandle(once);
      expect(twice).toBe(once);
    }
  });
});

describe("cleanUrl", () => {
  it("preserves https URLs", () => {
    expect(cleanUrl("https://example.com")).toBe("https://example.com");
    expect(cleanUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1"
    );
  });

  it("preserves http URLs", () => {
    expect(cleanUrl("http://example.com")).toBe("http://example.com");
  });

  it("prepends https:// to bare hostnames", () => {
    expect(cleanUrl("example.com")).toBe("https://example.com");
    expect(cleanUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("is case-insensitive on the protocol check", () => {
    expect(cleanUrl("HTTPS://example.com")).toBe("HTTPS://example.com");
    expect(cleanUrl("Http://example.com")).toBe("Http://example.com");
  });

  it("trims whitespace before deciding", () => {
    expect(cleanUrl("  example.com  ")).toBe("https://example.com");
    expect(cleanUrl("\thttps://example.com\n")).toBe("https://example.com");
  });

  it("returns null for empty input", () => {
    expect(cleanUrl("")).toBeNull();
    expect(cleanUrl("   ")).toBeNull();
    expect(cleanUrl(null)).toBeNull();
    expect(cleanUrl(undefined)).toBeNull();
  });
});

describe("venmoPayUrl", () => {
  it("composes a Venmo universal pay URL", () => {
    const url = venmoPayUrl("cruzgolfer", 12.5, "Cruz Golf · JGCC · May 12");
    expect(url).toContain("https://venmo.com/cruzgolfer");
    expect(url).toContain("txn=pay");
    expect(url).toContain("amount=12.50");
    // URLSearchParams uses the application/x-www-form-urlencoded
    // convention: spaces become "+", "·" (U+00B7) becomes "%C2%B7".
    // Both are valid in a query string per RFC 3986; Venmo's web +
    // app URL handlers accept either encoding for `note`.
    expect(url).toContain("note=Cruz+Golf");
    expect(url).toContain("%C2%B7"); // the "·" separator is encoded
  });

  it("formats amount to 2 decimals", () => {
    expect(venmoPayUrl("a", 5, "n")).toContain("amount=5.00");
    expect(venmoPayUrl("a", 5.1, "n")).toContain("amount=5.10");
    expect(venmoPayUrl("a", 5.123, "n")).toContain("amount=5.12");
  });

  it("URL-encodes the handle (defense vs accidental whitespace / unicode)", () => {
    // Pre-cleaning is the caller's job, but if junk slips through we
    // shouldn't break the URL. encodeURIComponent uses %20 for spaces
    // (path component convention, NOT form-data); URLSearchParams uses
    // "+" for spaces in the query. We use encodeURIComponent on the
    // handle (path segment) and URLSearchParams for the rest.
    const url = venmoPayUrl("cruz golfer", 1, "n");
    expect(url).toContain("https://venmo.com/cruz%20golfer");
  });

  it("handles zero / decimal-edge amounts", () => {
    expect(venmoPayUrl("a", 0, "n")).toContain("amount=0.00");
    expect(venmoPayUrl("a", 99999.99, "n")).toContain("amount=99999.99");
  });
});

describe("venmoNoteForRound", () => {
  it("composes course + date", () => {
    expect(venmoNoteForRound("JGCC", "2026-05-12")).toBe(
      "Cruz Golf · JGCC · May 12"
    );
  });

  it("falls back to course-only when date is missing", () => {
    expect(venmoNoteForRound("JGCC", null)).toBe("Cruz Golf · JGCC");
    expect(venmoNoteForRound("JGCC", undefined)).toBe("Cruz Golf · JGCC");
    expect(venmoNoteForRound("JGCC", "")).toBe("Cruz Golf · JGCC");
  });

  it("falls back to course-only when date is malformed", () => {
    // Not in YYYY-MM-DD shape — skip the date.
    expect(venmoNoteForRound("JGCC", "May 12 2026")).toBe(
      "Cruz Golf · JGCC"
    );
    expect(venmoNoteForRound("JGCC", "2026/05/12")).toBe("Cruz Golf · JGCC");
  });

  it("falls back to date-only when course is missing", () => {
    expect(venmoNoteForRound(null, "2026-05-12")).toBe(
      "Cruz Golf · May 12"
    );
    expect(venmoNoteForRound("", "2026-05-12")).toBe("Cruz Golf · May 12");
    expect(venmoNoteForRound("   ", "2026-05-12")).toBe(
      "Cruz Golf · May 12"
    );
  });

  it("falls back to 'Cruz Golf' alone when both are missing", () => {
    expect(venmoNoteForRound(null, null)).toBe("Cruz Golf");
    expect(venmoNoteForRound(undefined, undefined)).toBe("Cruz Golf");
  });

  it("renders the date stably regardless of TZ at noon-UTC parse", () => {
    // Critical regression: parsing "2026-05-12" as local midnight then
    // converting to en-US can shift the date by a day depending on the
    // host TZ. We parse at noon UTC + format with timeZone: "UTC" to
    // prevent that. Smoke-test by feeding the same date twice and
    // making sure the day-of-month doesn't drift.
    const a = venmoNoteForRound("JGCC", "2026-01-01");
    const b = venmoNoteForRound("JGCC", "2026-12-31");
    expect(a).toMatch(/Jan 1/);
    expect(b).toMatch(/Dec 31/);
  });
});
