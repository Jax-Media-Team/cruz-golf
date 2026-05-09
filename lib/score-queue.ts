/**
 * Pure functions for the score-save queue. Kept side-effect-free and
 * Storage-agnostic so they can be unit-tested in isolation.
 *
 * The hook in lib/useScoreSaver.ts wraps these with localStorage and
 * the Supabase client.
 */

export type SaveKey = string; // `${round_player_id}:${hole_number}`

export type PendingItem = {
  key: SaveKey;
  round_player_id: string;
  hole_number: number;
  gross: number;
  attempts: number;
  /** ms epoch — used to flag stale items still pending after a long time */
  enqueuedAt: number;
};

export const QUEUE_STORAGE_KEY = "cruz-golf:pendingScores:v1";

export function makeKey(round_player_id: string, hole_number: number): SaveKey {
  return `${round_player_id}:${hole_number}`;
}

/**
 * Drop any prior pending item for the same key; append the new one to the tail.
 * Newest write per key wins. Order is otherwise preserved.
 */
export function enqueueOrReplace(queue: PendingItem[], item: PendingItem): PendingItem[] {
  const filtered = queue.filter((it) => it.key !== item.key);
  filtered.push(item);
  return filtered;
}

/** Remove the head item from the queue. Used after a successful drain step. */
export function dropHead(queue: PendingItem[]): PendingItem[] {
  return queue.slice(1);
}

/**
 * Parse a localStorage payload back into a queue. Tolerant of corruption,
 * older versions, etc. Always returns an array.
 */
export function deserialize(raw: string | null): PendingItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingItem);
  } catch {
    return [];
  }
}

export function serialize(queue: PendingItem[]): string {
  return JSON.stringify(queue);
}

function isPendingItem(x: unknown): x is PendingItem {
  if (!x || typeof x !== "object") return false;
  const it = x as Record<string, unknown>;
  return (
    typeof it.key === "string" &&
    typeof it.round_player_id === "string" &&
    typeof it.hole_number === "number" &&
    typeof it.gross === "number" &&
    typeof it.attempts === "number" &&
    typeof it.enqueuedAt === "number"
  );
}
