import type { CourseHole, ScoreCapMode } from "./types";

export const STANDARD_SLOPE = 113;

function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5 + Number.EPSILON);
}

export function courseHandicap(
  handicapIndex: number,
  slope: number,
  rating: number,
  par: number,
  holes: 9 | 18 = 18
): number {
  const hi = holes === 9 ? handicapIndex / 2 : handicapIndex;
  const value = hi * (slope / STANDARD_SLOPE) + (rating - par);
  return roundHalfUp(value);
}

export function playingHandicap(courseHc: number, allowancePct: number): number {
  if (allowancePct === 100) return courseHc;
  const value = (courseHc * allowancePct) / 100;
  return roundHalfUp(value);
}

/**
 * Distribute a player's strokes across the holes by stroke index.
 * Returns an array indexed by hole_number-1 of strokes received that hole.
 * Handles plus handicaps (negative => give strokes back on highest-SI holes).
 * Wraps for hc > number of holes.
 */
export function strokesPerHole(
  playingHc: number,
  holes: Pick<CourseHole, "hole_number" | "stroke_index">[]
): number[] {
  const n = holes.length;
  const result = new Array<number>(n).fill(0);
  if (n === 0 || playingHc === 0) return result;

  // Map stroke index (1=hardest) to hole_number-1.
  const sorted = [...holes].sort((a, b) => a.stroke_index - b.stroke_index);
  const ascByDifficulty = sorted.map((h) => h.hole_number - 1);

  if (playingHc > 0) {
    let remaining = playingHc;
    while (remaining > 0) {
      const give = Math.min(remaining, n);
      for (let i = 0; i < give; i++) result[ascByDifficulty[i]] += 1;
      remaining -= give;
    }
  } else {
    // Plus handicap: give strokes back, hardest-to-easiest reversed.
    const reversed = ascByDifficulty.slice().reverse();
    let remaining = -playingHc;
    while (remaining > 0) {
      const take = Math.min(remaining, n);
      for (let i = 0; i < take; i++) result[reversed[i]] -= 1;
      remaining -= take;
    }
  }
  return result;
}

export function netForHole(gross: number, strokes: number): number {
  return gross - strokes;
}

/**
 * Apply maximum-hole-score cap (ESC / Net Double Bogey style).
 * Returns the capped gross. The raw gross is preserved by callers separately.
 */
export function applyCap(
  gross: number,
  par: number,
  strokes: number,
  mode: ScoreCapMode
): number {
  if (mode === "none") return gross;
  if (mode === "triple_bogey") {
    const cap = par + 3 + strokes;
    return Math.min(gross, cap);
  }
  // double_bogey_plus = WHS Net Double Bogey
  const cap = par + 2 + strokes;
  return Math.min(gross, cap);
}
