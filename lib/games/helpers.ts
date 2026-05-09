import type { GameOutput, PlayerDelta, UUID } from "../types";

export function emptyOutput(): GameOutput {
  return { perPlayer: new Map(), status: "live", highlights: [] };
}

export function ensure(map: Map<UUID, PlayerDelta>, id: UUID): PlayerDelta {
  let v = map.get(id);
  if (!v) {
    v = { delta_cents: 0, breakdown: [] };
    map.set(id, v);
  }
  return v;
}

export function addDelta(
  map: Map<UUID, PlayerDelta>,
  id: UUID,
  delta: number,
  reason: string
) {
  const r = ensure(map, id);
  r.delta_cents += delta;
  r.breakdown.push(reason);
}

export function distributeFromLosersToWinner(
  map: Map<UUID, PlayerDelta>,
  winners: UUID[],
  losers: UUID[],
  perLoserCents: number,
  reason: string
) {
  if (winners.length === 0 || losers.length === 0 || perLoserCents <= 0) return;
  const totalIn = perLoserCents * losers.length;
  const each = Math.floor(totalIn / winners.length);
  // Distribute remainder to winners deterministically (sorted by id).
  const remainder = totalIn - each * winners.length;
  for (const l of losers) addDelta(map, l, -perLoserCents, reason);
  const sortedWinners = [...winners].sort();
  sortedWinners.forEach((w, i) => {
    const extra = i < remainder ? 1 : 0;
    addDelta(map, w, each + extra, reason);
  });
}

export function assertZeroSum(out: GameOutput): void {
  let sum = 0;
  for (const v of out.perPlayer.values()) sum += v.delta_cents;
  if (sum !== 0) {
    throw new Error(`Game settlement is not zero-sum: ${sum} cents`);
  }
}

export function holesPlayed(totalHoles: 9 | 18, startingHole: number): number[] {
  if (totalHoles === 18) {
    // Wrap from starting hole.
    return Array.from({ length: 18 }, (_, i) => ((startingHole - 1 + i) % 18) + 1);
  }
  // 9-hole round: keep simple — front 9 if starting at 1, else back 9.
  if (startingHole === 1) return Array.from({ length: 9 }, (_, i) => i + 1);
  return Array.from({ length: 9 }, (_, i) => i + 10);
}

import type { GameInput, CourseHole, RoundPlayer } from "../types";

/**
 * Filter and order the course holes to only those actually being played in
 * this round, in playing order (respecting startingHole on shotgun starts).
 */
export function holesInPlay(input: GameInput): CourseHole[] {
  const totalHoles = (input.totalHoles ?? 18) as 9 | 18;
  const startingHole = input.startingHole ?? 1;
  const order = holesPlayed(totalHoles, startingHole);
  const byNumber = new Map(input.course.holes.map((h) => [h.hole_number, h]));
  return order.map((n) => byNumber.get(n)).filter((h): h is CourseHole => h != null);
}

/**
 * Apply the game's `allowance_pct` to each player's playing handicap.
 * USGA "playing allowance" — common values: 100% individual stroke play,
 * 90% individual stroke against full field, 85% 4-ball, 80% best-ball.
 *
 * Returns a NEW player array (never mutates input). Only meaningful for
 * net games — gross engines pass the originals through unchanged.
 */
export function applyAllowance(players: RoundPlayer[], allowance_pct: number | undefined): RoundPlayer[] {
  const pct = allowance_pct ?? 100;
  if (pct === 100) return players;
  return players.map((p) => ({
    ...p,
    playing_handicap: Math.round((p.playing_handicap * pct) / 100)
  }));
}
