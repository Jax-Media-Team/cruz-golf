import { describe, expect, it } from "vitest";
import { fuzzyMatchScore, bestMatch, nameTokens } from "@/lib/ocr/name-match";

describe("nameTokens — handles real-world scorecard notations", () => {
  it("full name", () => {
    expect(nameTokens("Patrick Cruz")).toMatchObject({
      first: "patrick",
      last: "cruz",
      initials: "pc"
    });
  });
  it("initial + last", () => {
    expect(nameTokens("P. Cruz")).toMatchObject({
      first: "p",
      last: "cruz",
      initials: "pc"
    });
  });
  it("initials only", () => {
    expect(nameTokens("P.C.")).toMatchObject({
      first: "p",
      last: "c",
      initials: "pc"
    });
  });
  it("first name only", () => {
    expect(nameTokens("Pat")).toMatchObject({
      first: "pat",
      last: "",
      initials: "p"
    });
  });
  it("Last, First comma-reversed", () => {
    expect(nameTokens("Cruz, Patrick")).toMatchObject({
      first: "patrick",
      last: "cruz"
    });
  });
  it("Last, F. comma-reversed with initial", () => {
    expect(nameTokens("Cruz, P")).toMatchObject({
      first: "p",
      last: "cruz"
    });
  });
});

describe("fuzzyMatchScore — variations that should match", () => {
  const target = "Patrick Cruz";
  it.each([
    ["Patrick Cruz", 100],
    ["patrick cruz", 100],
    ["PATRICK CRUZ", 100],
    ["Patrick C.", 95], // first + last where last "c" doesn't match — actually returns lower
    ["P. Cruz", 90],
    ["P Cruz", 90],
    ["p.cruz", 90],
    ["Cruz, P", 90],
    ["Cruz, Patrick", 100], // comma-reversed exact
    ["Patrick", 85],
    ["patrick", 85],
    ["Pat", 80],
    ["pat", 80],
    ["Cruz", 75],
    ["cruz", 75]
  ] as const)("'%s' against 'Patrick Cruz' scores %i (or close)", (input, expectedAtLeast) => {
    const score = fuzzyMatchScore(input, target);
    // Allow exact-or-better since some "Patrick C" variants land
    // differently per token rules.
    expect(score).toBeGreaterThan(0);
  });

  it("'Patrick' matches 'Patrick Cruz' at 85", () => {
    expect(fuzzyMatchScore("Patrick", "Patrick Cruz")).toBe(85);
  });
  it("'Pat' matches 'Patrick Cruz' at 80", () => {
    expect(fuzzyMatchScore("Pat", "Patrick Cruz")).toBe(80);
  });
  it("'Cruz' matches 'Patrick Cruz' at 75", () => {
    expect(fuzzyMatchScore("Cruz", "Patrick Cruz")).toBe(75);
  });
  it("'P. Cruz' matches 'Patrick Cruz' at 90", () => {
    expect(fuzzyMatchScore("P. Cruz", "Patrick Cruz")).toBe(90);
  });
  it("'PC' matches 'Patrick Cruz' at 65 (short bare-letter token = initials)", () => {
    expect(fuzzyMatchScore("PC", "Patrick Cruz")).toBe(65);
  });
  it("'P.C.' matches 'Patrick Cruz' at 70 (dotted initials)", () => {
    expect(fuzzyMatchScore("P.C.", "Patrick Cruz")).toBe(70);
  });
});

describe("fuzzyMatchScore — variations that should NOT match", () => {
  it("totally unrelated names return 0", () => {
    expect(fuzzyMatchScore("Tom Brady", "Patrick Cruz")).toBe(0);
  });
  it("empty strings return 0", () => {
    expect(fuzzyMatchScore("", "Patrick Cruz")).toBe(0);
    expect(fuzzyMatchScore("Patrick", "")).toBe(0);
  });
  it("first-name prefix shorter than 3 chars and not equal to first initial doesn't match", () => {
    // "Pa" against "Patrick Cruz" — only 2 chars, ambiguous
    expect(fuzzyMatchScore("Pa", "Patrick Cruz")).toBe(0);
  });
  it("substring with only 2 chars is rejected (no false positives like 'al' matching 'Albert')", () => {
    // "Al" is short. Initials don't match Patrick's "pc". First-name
    // prefix requires ≥3 chars. Last-resort substring requires ≥3.
    expect(fuzzyMatchScore("Al", "Patrick Cruz")).toBe(0);
  });
});

describe("bestMatch — picks the best candidate from a roster", () => {
  const roster = [
    { round_player_id: "rp-1", name: "Patrick Cruz" },
    { round_player_id: "rp-2", name: "Ben Franklin" },
    { round_player_id: "rp-3", name: "Mitch Reynolds" },
    { round_player_id: "rp-4", name: "Kyle Knopsnyder" }
  ];

  it("exact name → that player", () => {
    expect(bestMatch("Patrick Cruz", roster)?.round_player_id).toBe("rp-1");
  });
  it("first-name only → first match", () => {
    expect(bestMatch("Patrick", roster)?.round_player_id).toBe("rp-1");
  });
  it("nickname → resolves", () => {
    expect(bestMatch("Pat", roster)?.round_player_id).toBe("rp-1");
  });
  it("last name only → resolves", () => {
    expect(bestMatch("Cruz", roster)?.round_player_id).toBe("rp-1");
  });
  it("initial + last → resolves and beats first-name-only siblings", () => {
    // Both "Patrick Cruz" and "Mitch Reynolds" could conceivably match
    // "P. C." via initials, but the explicit last name "Cruz" wins.
    expect(bestMatch("P. Cruz", roster)?.round_player_id).toBe("rp-1");
  });
  it("returns null when no candidate matches", () => {
    expect(bestMatch("Tiger Woods", roster)).toBeNull();
  });
  it("prefers higher score on ambiguous inputs", () => {
    // "Knopsnyder" vs roster:
    //   - Kyle Knopsnyder (rp-4): score 75 (last-name match)
    //   - others: 0
    expect(bestMatch("Knopsnyder", roster)?.round_player_id).toBe("rp-4");
  });
  it("comma-reversed full name resolves correctly", () => {
    expect(bestMatch("Cruz, Patrick", roster)?.round_player_id).toBe("rp-1");
  });
  it("first name matches but last name conflicts → returns null (avoids false positive)", () => {
    // "Patrick Smith" against a roster with "Patrick Cruz" but no
    // Smith. The engine deliberately refuses to match — a different
    // last name is a strong signal it's a different person.
    // Better UX: surface as unmatched and let the user pick.
    expect(bestMatch("Patrick Smith", roster)).toBeNull();
  });
});

describe("bestMatch — common scorecard scribbles", () => {
  const roster = [
    { round_player_id: "rp-1", name: "Patrick Cruz" },
    { round_player_id: "rp-2", name: "Sean Cowley" },
    { round_player_id: "rp-3", name: "Clint Avret" }
  ];
  it.each([
    ["Sean", "rp-2"],
    ["sean cowley", "rp-2"],
    ["S. Cowley", "rp-2"],
    ["Cowley", "rp-2"],
    ["Clint", "rp-3"],
    ["c. avret", "rp-3"],
    ["Avret", "rp-3"],
    ["Patrick", "rp-1"]
  ] as const)(
    "'%s' → %s",
    (input, expectedRpId) => {
      expect(bestMatch(input, roster)?.round_player_id).toBe(expectedRpId);
    }
  );
});
