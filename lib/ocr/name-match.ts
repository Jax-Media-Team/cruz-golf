/**
 * Fuzzy name matching for scorecard OCR.
 *
 * Real-world scorecards have all kinds of name notations. Players
 * scribble "Pat" when the app has "Patrick Cruz"; or "P. Cruz" or
 * "Cruz, P". The OCR pipeline transcribes those literally; THIS layer
 * resolves them back to the round's actual players.
 *
 * Pure functions — no DOM, no Supabase. Tested in isolation against a
 * suite of real-world name variations.
 */

type Tokens = {
  first: string;
  last: string;
  initials: string;
  normalized: string;
};

/**
 * Tokenize a display name into normalized first / last / initials.
 *   "Patrick Cruz" → { first: "patrick", last: "cruz", initials: "pc" }
 *   "P. Cruz"      → { first: "p", last: "cruz", initials: "pc" }
 *   "P.C."         → { first: "p", last: "c", initials: "pc" }
 *   "Cruz, P"      → { first: "p", last: "cruz", initials: "pc" }
 *   "Pat"          → { first: "pat", last: "", initials: "p" }
 */
export function nameTokens(s: string): Tokens {
  const cleaned = s
    .replace(/[.,;:]/g, " ")
    .trim()
    .toLowerCase();
  // Handle "Cruz, Patrick" → "patrick cruz" reordering
  const commaSplit = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const reordered =
    commaSplit.length === 2
      ? `${commaSplit[1].toLowerCase()} ${commaSplit[0].toLowerCase()}`
          .replace(/[.,;:]/g, " ")
      : cleaned;
  const parts = reordered.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const initials = parts.map((p) => p[0] ?? "").join("");
  return {
    first,
    last,
    initials,
    normalized: reordered.replace(/[^a-z0-9]/g, "")
  };
}

/**
 * Score a candidate match between an OCR-extracted name and a round
 * player. Higher = better. Returns 0 for non-matches.
 *
 * Score thresholds (informational, used for tie-breaking ranking):
 *   100 — exact normalized match
 *    95 — full first + matching last
 *    90 — initial + full last ("P. Cruz" vs "Patrick Cruz")
 *    85 — full first name only, equal
 *    80 — first-name prefix (≥3 chars; e.g. "Pat" → "Patrick")
 *    75 — last name only
 *    70 — initials only (2-3 chars matching player's first-letters)
 *    50 — substring fallback (last resort)
 *     0 — no match
 */
export function fuzzyMatchScore(
  ocrName: string,
  playerName: string
): number {
  const o = nameTokens(ocrName);
  const p = nameTokens(playerName);
  if (!o.normalized || !p.normalized) return 0;

  if (o.normalized === p.normalized) return 100;

  if (o.first && o.last && o.first === p.first && o.last === p.last)
    return 95;

  // Initial + full last (e.g. "P. Cruz" vs "Patrick Cruz")
  if (
    o.first.length === 1 &&
    p.first.startsWith(o.first) &&
    o.last &&
    o.last === p.last
  )
    return 90;

  // Full first name only, no last given
  if (
    o.first &&
    !o.last &&
    p.first.startsWith(o.first) &&
    o.first.length >= 3
  )
    return o.first === p.first ? 85 : 80;

  // Last name only
  if (!o.last && o.first && o.first === p.last) return 75;

  // Initials in a few different flavors:
  //   "P.C."  → tokens first="p" last="c" initials="pc" (each letter is a token)
  //   "PC"    → tokens first="pc" last="" initials="p" (single token, short)
  //   "P. C." → same as P.C.
  // We want all three to match a player whose initials match.
  // Flavor 1: each letter became its own token; check o.initials === p.initials
  if (
    o.first.length === 1 &&
    (o.last.length === 1 || !o.last) &&
    o.initials === p.initials
  )
    return 70;
  // Flavor 2: 2-3 char first-only token; either letter-by-letter equals
  // p.initials, or initials computed from the token equal p.initials.
  if (
    !o.last &&
    o.first.length >= 2 &&
    o.first.length <= 3 &&
    (o.initials === p.initials || o.first === p.initials)
  )
    return 65;

  // Last-resort substring (≥3 chars on both sides so "A" doesn't
  // accidentally match every name)
  if (
    o.normalized.length >= 3 &&
    p.normalized.length >= 3 &&
    (p.normalized.includes(o.normalized) ||
      o.normalized.includes(p.normalized))
  )
    return 50;

  return 0;
}

export type MatchCandidate = {
  round_player_id: string;
  name: string;
};

/**
 * Pick the best-scoring player for an OCR name. Breaks ties by score
 * then alphabetical name. Returns null when no candidate has a
 * positive score.
 */
export function bestMatch(
  ocrName: string,
  candidates: MatchCandidate[]
): (MatchCandidate & { score: number }) | null {
  const scored = candidates
    .map((c) => ({ ...c, score: fuzzyMatchScore(ocrName, c.name) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored[0] ?? null;
}
