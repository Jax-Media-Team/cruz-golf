/**
 * Pure helper for parsing the `settlements.breakdown` JSONB column into
 * the per-side per-game delta arrays the SettlementSummary card renders.
 *
 * The settle-flow writes:
 *   breakdown: [{ game: string, from: number, to: number }, ...]
 * — one entry per game-line, with `from` = the FROM-side player's delta
 * (cents) on that game and `to` = the TO-side player's delta on that
 * game. The shape is identical for parent games + junk + accepted
 * presses; see `app/(app)/rounds/[id]/finalize/finalize-view.tsx`.
 *
 * Old / malformed settlements (legacy data or hand-edited rows) might
 * arrive as null, undefined, or unexpected shapes — this helper
 * defends against all of them and returns empty arrays so the UI
 * just hides the "How this was calculated" expander instead of
 * crashing.
 */

export type BreakdownItem = {
  /** Game name as it appeared in the settle output. */
  game: string;
  /** Cents — positive = won that game, negative = lost. */
  cents: number;
};

export type ParsedSettlementBreakdown = {
  /** Per-game deltas for the FROM-side player. Filtered to non-zero. */
  fromDeltas: BreakdownItem[];
  /** Per-game deltas for the TO-side player. Filtered to non-zero. */
  toDeltas: BreakdownItem[];
  /** Sum of fromDeltas — the FROM player's NET across this round
   *  (negative means they're a net payer overall). */
  fromTotal: number;
  /** Sum of toDeltas — the TO player's NET across this round
   *  (positive means they're a net recipient overall). */
  toTotal: number;
};

/**
 * Parse a `settlements.breakdown` JSONB column.
 *
 * Defensive:
 *   - null / undefined / non-array → empty result (no crash, no panel)
 *   - missing `game` / `from` / `to` fields → skipped
 *   - non-numeric `from` / `to` → coerced to 0 (skipped by the
 *     non-zero filter)
 *   - non-string `game` → coerced to "" (still rendered, but won't crash)
 *
 * Returns the filtered-to-non-zero arrays + their sums. The UI uses
 * the totals to detect "this transfer is part of a chain" (when
 * |fromTotal| !== flow.amount_cents).
 */
export function parseSettlementBreakdown(
  raw: unknown
): ParsedSettlementBreakdown {
  const empty: ParsedSettlementBreakdown = {
    fromDeltas: [],
    toDeltas: [],
    fromTotal: 0,
    toTotal: 0
  };
  if (!Array.isArray(raw)) return empty;

  const fromDeltas: BreakdownItem[] = [];
  const toDeltas: BreakdownItem[] = [];

  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const game = typeof e.game === "string" ? e.game : "";
    const from = typeof e.from === "number" && Number.isFinite(e.from) ? e.from : 0;
    const to = typeof e.to === "number" && Number.isFinite(e.to) ? e.to : 0;
    if (from !== 0) fromDeltas.push({ game, cents: from });
    if (to !== 0) toDeltas.push({ game, cents: to });
  }

  const fromTotal = fromDeltas.reduce((s, x) => s + x.cents, 0);
  const toTotal = toDeltas.reduce((s, x) => s + x.cents, 0);

  return { fromDeltas, toDeltas, fromTotal, toTotal };
}
