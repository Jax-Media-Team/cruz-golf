import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput, holesInPlay } from "./helpers";
import { detectAutoPresses, pressPotsBySide, type HoleResult } from "./press";
import { isAutoPress2Down } from "./config-normalize";

/**
 * 6-6-6: a 4-player game played in three 6-hole segments. Partners rotate so
 * each player is teamed with each other player for one segment.
 *
 * Default rotation (auto-derived if config.rotation is not provided):
 *   Holes 1-6:   AB vs CD
 *   Holes 7-12:  AC vs BD
 *   Holes 13-18: AD vs BC
 *
 * Each segment is settled as best-ball (lower of the two partners' net scores
 * per hole), match-play style across the 6 holes. Loser of each segment pays
 * `stake_cents` per player to the winning side. Tied segments push.
 *
 * config (optional):
 *   rotation: an array of three { team_a: [pid, pid], team_b: [pid, pid] }
 *             objects to override the default partner cycle.
 *   net: bool — use net scores (default true)
 *   match_play: bool — true = head-to-head per hole; false = sum of best balls
 *               across the 6 holes (default true)
 *   presses: "none" | "manual" | "auto_2_down" — auto-fire when one side
 *            goes 2-down with 3+ holes left WITHIN A SEGMENT. Each segment
 *            has its own press chain (partner pairings change between
 *            segments, so a press in segment 1 doesn't carry into segment 2).
 *            Manual presses (via /rounds/[id]/press-controls) work for any
 *            6-6-6 round regardless of this config. Default: "none".
 */

type Pair = [UUID, UUID];
type SegmentRotation = { team_a: Pair; team_b: Pair };

export function settleSixSixSix(input: GameInput): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;
  if (stake <= 0) return out;
  if (input.players.length !== 4) return out;

  const cfg = (input.game.config ?? {}) as {
    rotation?: SegmentRotation[];
    net?: boolean;
    match_play?: boolean;
    presses?: "none" | "manual" | "auto_2_down";
  };
  const useNet = cfg.net ?? true;
  const matchPlay = cfg.match_play ?? true;
  const autoPress = isAutoPress2Down(cfg);

  const playerIds = input.players.map((p) => p.id);
  for (const id of playerIds) addDelta(out.perPlayer, id, 0, "");

  // Default rotation: A=0, B=1, C=2, D=3
  // Segment 1: AB vs CD; 2: AC vs BD; 3: AD vs BC
  const rotation: SegmentRotation[] =
    cfg.rotation ?? [
      { team_a: [playerIds[0], playerIds[1]], team_b: [playerIds[2], playerIds[3]] },
      { team_a: [playerIds[0], playerIds[2]], team_b: [playerIds[1], playerIds[3]] },
      { team_a: [playerIds[0], playerIds[3]], team_b: [playerIds[1], playerIds[2]] }
    ];

  if (rotation.length !== 3) return out;

  const sheets = new Map(
    input.players.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const allHoles = holesInPlay(input);
  // 6-6-6 needs exactly 18 holes (three 6-hole segments). Skip silently on
  // a 9-hole round so the engine doesn't crash; UI should warn earlier.
  if (allHoles.length !== 18) return out;

  const segments: Array<typeof allHoles> = [
    allHoles.slice(0, 6),
    allHoles.slice(6, 12),
    allHoles.slice(12, 18)
  ];

  let lastPlayedHole = 0;
  segments.forEach((segHoles, idx) => {
    const { team_a, team_b } = rotation[idx];

    const sideHoleScore = (side: Pair, holeNumber: number): number | null => {
      const arr: number[] = [];
      for (const pid of side) {
        const sheet = sheets.get(pid);
        if (!sheet) return null;
        const row = sheet.rows.find((r) => r.hole_number === holeNumber);
        const v = useNet ? row?.net : row?.gross;
        if (v == null) return null;
        arr.push(v);
      }
      return Math.min(...arr);
    };

    if (matchPlay) {
      // Build per-hole HoleResult[] for this segment — used by both the
      // segment-payout calc and the press primitive. Aligns with the
      // way Nassau (lib/games/nassau.ts) wires presses per segment.
      const segHoleResults: HoleResult[] = segHoles.map((h) => {
        const a = sideHoleScore(team_a, h.hole_number);
        const b = sideHoleScore(team_b, h.hole_number);
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

      let aUp = 0;
      let played = 0;
      for (const hr of segHoleResults) {
        if (hr.incomplete) continue;
        played++;
        if (hr.a_won) aUp++;
        else if (hr.b_won) aUp--;
      }
      if (played === segHoles.length) {
        lastPlayedHole = Math.max(lastPlayedHole, segHoles[segHoles.length - 1].hole_number);
        if (aUp !== 0) {
          const winningSide = aUp > 0 ? team_a : team_b;
          const losingSide = aUp > 0 ? team_b : team_a;
          for (const pid of losingSide) addDelta(out.perPlayer, pid, -stake, `666 segment ${idx + 1}`);
          for (const pid of winningSide) addDelta(out.perPlayer, pid, +stake, `666 segment ${idx + 1}`);
        }
      }

      // Auto-press settlement within this segment. Each segment has
      // independent presses — partners rotate between segments, so a
      // press doesn't carry over. Standard rule: trigger at 2-down,
      // min 3 holes left in the segment, cap of 4 presses per side
      // per segment (matches Nassau).
      if (autoPress) {
        const presses = detectAutoPresses(segHoleResults, {
          triggerDown: 2,
          minRemainingHoles: 3,
          maxPresses: 4,
          stakeCents: stake,
          segmentLabel: `666 seg ${idx + 1}`,
          segmentStart: 0,
          segmentEnd: segHoleResults.length
        });
        if (presses.length > 0) {
          const pots = pressPotsBySide(presses, [...team_a], [...team_b]);
          for (const [pid, delta] of pots.entries()) {
            if (delta !== 0) {
              const labels = presses
                .filter((p) => p.result_delta != null && p.result_delta !== 0)
                .map((p) => p.label)
                .join(" + ");
              addDelta(out.perPlayer, pid, delta, labels || `666 seg ${idx + 1} presses`);
            }
          }
        }
      }
    } else {
      // Stroke-play within the segment: sum of best-ball over the 6 holes.
      let aTot = 0;
      let bTot = 0;
      let played = 0;
      for (const h of segHoles) {
        const a = sideHoleScore(team_a, h.hole_number);
        const b = sideHoleScore(team_b, h.hole_number);
        if (a == null || b == null) continue;
        played++;
        aTot += a;
        bTot += b;
      }
      if (played === segHoles.length && aTot !== bTot) {
        lastPlayedHole = Math.max(lastPlayedHole, segHoles[segHoles.length - 1].hole_number);
        const aWon = aTot < bTot;
        const winningSide = aWon ? team_a : team_b;
        const losingSide = aWon ? team_b : team_a;
        for (const pid of losingSide) addDelta(out.perPlayer, pid, -stake, `666 segment ${idx + 1}`);
        for (const pid of winningSide) addDelta(out.perPlayer, pid, +stake, `666 segment ${idx + 1}`);
      }
    }
  });

  out.status = lastPlayedHole >= 18 ? "final" : "live";
  return out;
}
