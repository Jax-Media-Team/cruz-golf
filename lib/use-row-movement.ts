"use client";
/**
 * Generic rank-movement hook for any leaderboard surface.
 *
 * Takes a Map<id, position> on each render and returns a Map<id, delta>
 * of recent movements. Composes the pure helpers in
 * `lib/leaderboard-movement.ts`. Both the round-level Leaderboard and
 * the event-level EventLeaderboard call this.
 *
 * Behavior:
 *   - First render establishes the baseline; NO movement indicators
 *     surface (no false signals on cold mount).
 *   - Every subsequent render diffs against the prior snapshot. Any
 *     non-zero deltas get a TTL.
 *   - Old deltas expire after `ttlMs` (default 6_000) — a 1s polling
 *     interval only runs while indicators are still visible.
 *   - Consumers reset by remounting (e.g. `key={tab}` on the wrapper).
 */
import { useEffect, useRef, useState } from "react";
import {
  diffPositions,
  expireMovements,
  mergeMovements,
  type MovementDelta
} from "./leaderboard-movement";

const DEFAULT_TTL_MS = 6_000;

export function useRowMovement(
  positions: Map<string, number>,
  ttlMs: number = DEFAULT_TTL_MS
): Map<string, MovementDelta> {
  const lastSnapshotRef = useRef<Map<string, number> | null>(null);
  const [movements, setMovements] = useState<Map<string, MovementDelta>>(
    new Map()
  );

  useEffect(() => {
    if (lastSnapshotRef.current === null) {
      // Initial mount — establish baseline, no indicators.
      lastSnapshotRef.current = new Map(positions);
      return;
    }
    const now = Date.now();
    const incoming = diffPositions(lastSnapshotRef.current, positions, now);
    lastSnapshotRef.current = new Map(positions);
    if (incoming.size > 0) {
      setMovements((prev) => mergeMovements(prev, incoming));
    }
  }, [positions]);

  useEffect(() => {
    if (movements.size === 0) return;
    const id = setInterval(() => {
      setMovements((prev) => expireMovements(prev, Date.now(), ttlMs));
    }, 1_000);
    return () => clearInterval(id);
  }, [movements, ttlMs]);

  return movements;
}
