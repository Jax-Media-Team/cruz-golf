/**
 * Handicap Index display + input helpers.
 *
 * Golf convention:
 *   - "Handicap Index 14.0" means a player who shoots 14 strokes over scratch
 *     on a neutral course. Stored internally as +14.0.
 *   - "Handicap Index +1.4" (note the leading PLUS sign) means a player who
 *     shoots 1.4 strokes UNDER scratch — better than the field. They give
 *     strokes back. Stored internally as -1.4.
 *
 * So: positive UI display "14.0" -> stored as +14
 *     positive UI display "+1.4" (note plus prefix) -> stored as -1.4
 *
 * The downstream `strokesPerHole` already handles negative values (gives
 * strokes back on the easiest holes), so all we need is parse/format glue.
 */

/**
 * Display a stored HI value the way golfers expect:
 *   null     -> "—"
 *   0        -> "0.0"
 *   14       -> "14.0"
 *   -1.4     -> "+1.4"   (note leading plus)
 */
export function formatHi(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 0) return `+${Math.abs(n).toFixed(1)}`;
  return n.toFixed(1);
}

/**
 * Parse a user-typed HI string back to the internal stored number.
 *   ""        -> null  (clears handicap)
 *   "14.0"    -> 14
 *   "14"      -> 14
 *   "+1.4"    -> -1.4   (plus index!)
 *   "-1.4"    -> -1.4   (also accepted — golfers sometimes type it this way)
 *   "garbage" -> null
 */
export function parseHi(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  // "+1.4" — leading + means plus-handicap, store as negative.
  if (s.startsWith("+")) {
    const n = parseFloat(s.slice(1));
    if (Number.isNaN(n)) return null;
    return -Math.abs(n);
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * Inverse of parseHi for prefilling a form input. Stored numbers come back
 * as the same string the user would type:
 *   null  -> ""
 *   14    -> "14"
 *   -1.4  -> "+1.4"
 */
export function hiInputValue(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 0) return `+${Math.abs(n)}`;
  return String(n);
}
