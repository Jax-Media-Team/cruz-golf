/**
 * Pure helpers for leaderboard movement indicators.
 *
 * The Leaderboard component shows positions but doesn't, on its own,
 * tell a spectator that anything changed. After a score lands and the
 * board re-ranks, the only signal is the new position number — easy to
 * miss when you're glancing at it on your phone from across the
 * clubhouse. These helpers compare two snapshots and surface "rp-pat
 * moved up 2" so the consumer can render a small ↑2 / ↓1 badge next to
 * the position for a few seconds.
 *
 * No React, no DOM. The hook that uses these lives in the Leaderboard
 * component (`useRowMovement`).
 */
import type { UUID } from "./types";

export type MovementDelta = {
  /** Positive = moved UP the board (better position). Negative = moved DOWN. */
  delta: number;
  /** Timestamp (ms) — consumers use this to fade the indicator out. */
  observed_at: number;
};

/**
 * Compare two position snapshots; return only the rp_ids whose position
 * actually changed, with the signed delta and a timestamp.
 *
 * Convention: position 1 is "first place" (best). Moving from 4 → 2 is
 * a +2 (moved UP). Moving from 2 → 4 is -2 (moved DOWN). This matches
 * leaderboard semantics, NOT the raw numeric subtraction.
 *
 * Newcomers (in `next` but not in `prev`) are intentionally NOT marked
 * as moved — there's no baseline to compare against, so the indicator
 * would be misleading.
 */
export function diffPositions(
  prev: Map<UUID, number>,
  next: Map<UUID, number>,
  now: number
): Map<UUID, MovementDelta> {
  const out = new Map<UUID, MovementDelta>();
  for (const [rpId, currPos] of next) {
    const prevPos = prev.get(rpId);
    if (prevPos === undefined) continue;
    if (prevPos === currPos) continue;
    out.set(rpId, {
      delta: prevPos - currPos, // 4 → 2 yields +2 (up)
      observed_at: now
    });
  }
  return out;
}

/**
 * Drop expired movement deltas from a tracking map. Returns a new map
 * (immutable for React). `ttlMs` is how long an indicator stays
 * visible — the canonical value is 6_000ms so a glance picks it up but
 * the board doesn't feel cluttered.
 */
export function expireMovements(
  movements: Map<UUID, MovementDelta>,
  now: number,
  ttlMs: number
): Map<UUID, MovementDelta> {
  let dirty = false;
  const out = new Map<UUID, MovementDelta>();
  for (const [rpId, m] of movements) {
    if (now - m.observed_at < ttlMs) {
      out.set(rpId, m);
    } else {
      dirty = true;
    }
  }
  // Stable identity when nothing expired — caller can rely on reference
  // equality to skip a re-render.
  return dirty ? out : movements;
}

/**
 * Merge incoming deltas into a tracking map. Newer deltas overwrite
 * older ones for the same rp_id (only the latest movement matters; an
 * older indicator is stale). Returns a new map.
 */
export function mergeMovements(
  base: Map<UUID, MovementDelta>,
  incoming: Map<UUID, MovementDelta>
): Map<UUID, MovementDelta> {
  if (incoming.size === 0) return base;
  const out = new Map(base);
  for (const [rpId, m] of incoming) {
    out.set(rpId, m);
  }
  return out;
}

/**
 * Human-readable indicator label for a movement delta. Statement style —
 * no emoji, no exclamation. Examples:
 *   diff 2 → "↑2"
 *   diff -1 → "↓1"
 *   diff 0 → "" (caller should not call this on zero — guarded)
 */
export function fmtMovement(delta: number): string {
  if (delta > 0) return `↑${delta}`;
  if (delta < 0) return `↓${Math.abs(delta)}`;
  return "";
}

export type RankedPosition = {
  /** 1-based position. Tied players share the same position. */
  position: number;
  /** True when this player is tied with at least one other player. */
  tied: boolean;
};

/**
 * Compute tied-aware leaderboard positions. The input array MUST be
 * pre-sorted by the same scoring key — this function only walks it
 * comparing adjacent entries via `keyFn`. Two players with equal keys
 * share a position; the next player skips ahead by the run length (real
 * tournament leaderboard semantics — "T1, T1, 3" not "T1, T1, 2").
 *
 * The boolean second return marks BOTH players in a tied pair so the
 * UI can render "T1" instead of "1" when applicable.
 *
 * Example: [-3, -3, -1, 0, 0, +1] → positions [1, 1, 3, 4, 4, 6],
 * tied: [true, true, false, true, true, false].
 */
export function rankWithTies<T>(
  sorted: T[],
  keyFn: (item: T) => number
): RankedPosition[] {
  const out: RankedPosition[] = [];
  let i = 0;
  while (i < sorted.length) {
    const k = keyFn(sorted[i]);
    let j = i + 1;
    while (j < sorted.length && keyFn(sorted[j]) === k) j += 1;
    const groupSize = j - i;
    const tied = groupSize > 1;
    for (let n = i; n < j; n++) {
      out.push({ position: i + 1, tied });
    }
    i = j;
  }
  return out;
}
