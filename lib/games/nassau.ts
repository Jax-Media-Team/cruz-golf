import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, applyAllowance, emptyOutput, holesInPlay } from "./helpers";
import { detectAutoPresses, pressPotsBySide, type HoleResult } from "./press";

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

  // Apply playing-handicap allowance for net Nassau (default 100% — gross
  // is unaffected since strokes don't enter the comparison).
  const adjusted = useNet ? applyAllowance(input.players, input.game.allowance_pct) : input.players;
  const sheets = new Map(
    adjusted.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const holes = holesInPlay(input);
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
        const winners = aUp > 0 ? sideA : sideB;
        const losers = aUp > 0 ? sideB : sideA;
        applySegmentPayout(winners, losers, stakeCents, label);
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
      applySegmentPayout(winners, losers, stakeCents, label);
    }
    return { settled: isComplete, aUp: bTotal - aTotal };
  }

  /**
   * Distribute a segment's payout. Each loser pays `stakeCents`. The total
   * pot is then split equally among winners, with any remainder cents
   * deterministically going to the first sorted winner. This keeps Nassau
   * zero-sum even when sides are uneven (1v3, 2v3, 4v4, etc.).
   */
  function applySegmentPayout(winners: UUID[], losers: UUID[], stakeCents: number, label: string) {
    if (winners.length === 0 || losers.length === 0 || stakeCents <= 0) return;
    const pot = stakeCents * losers.length;
    for (const id of losers) addDelta(out.perPlayer, id, -stakeCents, label);
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    const sortedWinners = [...winners].sort();
    sortedWinners.forEach((id, i) => {
      addDelta(out.perPlayer, id, each + (i < remainder ? 1 : 0), label);
    });
  }

  // Segment layout depends on total holes in play:
  //   18-hole round: front 9, back 9, overall 18
  //   9-hole round: just one "overall 9" segment using overallStake
  if (total === 9) {
    settleSegment(0, 9, overallStake, "Nassau 9");
  } else {
    if (total >= 9) {
      settleSegment(0, Math.min(9, total), frontStake, "Nassau front");
    }
    if (total >= 18) {
      settleSegment(9, 18, backStake, "Nassau back");
      settleSegment(0, 18, overallStake, "Nassau overall");
    }
  }

  // Press settlement — only when matchPlay AND presses=auto_2_down.
  // Builds a HoleResult[] from the per-side scoring sheets, runs each
  // segment through detectAutoPresses, and applies the pots.
  if (matchPlay && cfg.presses === "auto_2_down") {
    const segmentHoleResults: HoleResult[] = holes.map((h) => {
      const a = sideHoleScore(sideA, h.hole_number);
      const b = sideHoleScore(sideB, h.hole_number);
      if (a == null || b == null) {
        return {
          hole_number: h.hole_number,
          a_won: false,
          b_won: false,
          push: false,
          incomplete: true
        };
      }
      return {
        hole_number: h.hole_number,
        a_won: a < b,
        b_won: b < a,
        push: a === b,
        incomplete: false
      };
    });

    const segments: Array<{
      start: number;
      end: number;
      stake: number;
      label: string;
    }> =
      total === 9
        ? [{ start: 0, end: 9, stake: overallStake, label: "Nassau 9" }]
        : total >= 18
        ? [
            { start: 0, end: 9, stake: frontStake, label: "Nassau front" },
            { start: 9, end: 18, stake: backStake, label: "Nassau back" },
            { start: 0, end: 18, stake: overallStake, label: "Nassau overall" }
          ]
        : [
            {
              start: 0,
              end: Math.min(9, total),
              stake: frontStake,
              label: "Nassau front"
            }
          ];

    for (const seg of segments) {
      const presses = detectAutoPresses(segmentHoleResults, {
        triggerDown: 2,
        minRemainingHoles: 3,
        maxPresses: 4,
        stakeCents: seg.stake,
        segmentLabel: seg.label,
        segmentStart: seg.start,
        segmentEnd: seg.end
      });
      if (presses.length === 0) continue;
      const pots = pressPotsBySide(presses, sideA, sideB);
      for (const [pid, delta] of pots.entries()) {
        if (delta !== 0) {
          // Use the press's label for traceability — multiple presses
          // share the segment label but have a "press 1 / 2 / 3" suffix.
          const pressLabels = presses
            .filter((p) => p.result_delta != null && p.result_delta !== 0)
            .map((p) => p.label)
            .join(" + ");
          addDelta(out.perPlayer, pid, delta, pressLabels || `${seg.label} presses`);
        }
      }
    }
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
