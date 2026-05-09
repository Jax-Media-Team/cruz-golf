import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput } from "./helpers";

type NassauConfig = {
  net?: boolean;
  match_play?: boolean;
  front_stake_cents?: number;
  back_stake_cents?: number;
  overall_stake_cents?: number;
  presses?: "none" | "manual" | "auto_2_down";
};

/**
 * 2-player or 2-team Nassau. For team Nassau, all teammates share the per-player delta.
 * Auto-press is partially supported: detects 2-down with >= 3 holes left in the match and opens a sub-match.
 */
export function settleNassau(input: GameInput): GameOutput {
  const out = emptyOutput();
  const cfg = (input.game.config ?? {}) as NassauConfig;
  const useNet = cfg.net ?? true;
  const matchPlay = cfg.match_play ?? true;
  const frontStake = cfg.front_stake_cents ?? input.game.stake_cents;
  const backStake = cfg.back_stake_cents ?? input.game.stake_cents;
  const overallStake = cfg.overall_stake_cents ?? input.game.stake_cents;

  // Form sides: if teams exist, two teams; else first two players head-to-head.
  const teamMap = new Map<UUID, UUID[]>();
  for (const p of input.players) {
    if (p.team_id) {
      const arr = teamMap.get(p.team_id) ?? [];
      arr.push(p.id);
      teamMap.set(p.team_id, arr);
    }
  }
  let sideA: UUID[];
  let sideB: UUID[];
  if (teamMap.size >= 2) {
    const teamIds = [...teamMap.keys()];
    sideA = teamMap.get(teamIds[0])!;
    sideB = teamMap.get(teamIds[1])!;
  } else if (input.players.length >= 2) {
    sideA = [input.players[0].id];
    sideB = [input.players[1].id];
  } else {
    return out;
  }

  for (const id of [...sideA, ...sideB]) addDelta(out.perPlayer, id, 0, "");

  const sheets = new Map(
    input.players.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const holes = [...input.course.holes].sort((a, b) => a.hole_number - b.hole_number);
  const total = holes.length;

  const sideHoleScore = (side: UUID[], holeNumber: number): number | null => {
    const arr: number[] = [];
    for (const pid of side) {
      const row = sheets.get(pid)?.rows.find((r) => r.hole_number === holeNumber);
      const v = useNet ? row?.net : row?.gross;
      if (v == null) return null;
      arr.push(v);
    }
    // Two-player formats use single, team Nassau uses lower (best ball).
    return Math.min(...arr);
  };

  function settleSegment(startIdx: number, endIdx: number, stakeCents: number, label: string) {
    if (matchPlay) {
      let aUp = 0;
      let played = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const a = sideHoleScore(sideA, holes[i].hole_number);
        const b = sideHoleScore(sideB, holes[i].hole_number);
        // Skip holes not yet scored — keep counting later holes that ARE
        // scored. Segment still only settles when played === segLen.
        if (a == null || b == null) continue;
        played++;
        if (a < b) aUp++;
        else if (b < a) aUp--;
      }
      if (played === 0) return { settled: false, aUp: 0 };
      const segLen = endIdx - startIdx;
      const isComplete = played === segLen;
      // Money only moves when segment is final and not pushed.
      if (isComplete && aUp !== 0) {
        if (aUp > 0) {
          for (const id of sideB) addDelta(out.perPlayer, id, -stakeCents, label);
          for (const id of sideA) addDelta(out.perPlayer, id, +stakeCents, label);
        } else {
          for (const id of sideA) addDelta(out.perPlayer, id, -stakeCents, label);
          for (const id of sideB) addDelta(out.perPlayer, id, +stakeCents, label);
        }
      }
      return { settled: isComplete, aUp };
    }
    // stroke-play segment
    let aTotal = 0;
    let bTotal = 0;
    let played = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const a = sideHoleScore(sideA, holes[i].hole_number);
      const b = sideHoleScore(sideB, holes[i].hole_number);
      // Skip holes not yet scored — segment still only settles when complete.
      if (a == null || b == null) continue;
      aTotal += a;
      bTotal += b;
      played++;
    }
    const segLen = endIdx - startIdx;
    const isComplete = played === segLen;
    if (isComplete && aTotal !== bTotal) {
      const aWon = aTotal < bTotal;
      const winners = aWon ? sideA : sideB;
      const losers = aWon ? sideB : sideA;
      for (const id of losers) addDelta(out.perPlayer, id, -stakeCents, label);
      for (const id of winners) addDelta(out.perPlayer, id, +stakeCents, label);
    }
    return { settled: isComplete, aUp: bTotal - aTotal };
  }

  if (total >= 9) {
    settleSegment(0, Math.min(9, total), frontStake, "Nassau front");
  }
  if (total >= 18) {
    settleSegment(9, 18, backStake, "Nassau back");
    settleSegment(0, 18, overallStake, "Nassau overall");
  }

  // Determine status: final if last hole has scores for both sides.
  // Final only when EVERY hole has scores from both sides — not just the last one.
  let allScored = true;
  for (let i = 0; i < total; i++) {
    if (sideHoleScore(sideA, holes[i].hole_number) == null || sideHoleScore(sideB, holes[i].hole_number) == null) {
      allScored = false;
      break;
    }
  }
  out.status = allScored ? "final" : "live";
  return out;
}
