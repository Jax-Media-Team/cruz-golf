import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput } from "./helpers";

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
  };
  const useNet = cfg.net ?? true;
  const matchPlay = cfg.match_play ?? true;

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
  const allHoles = [...input.course.holes].sort((a, b) => a.hole_number - b.hole_number);
  if (allHoles.length < 18) return out;

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
      let aUp = 0;
      let played = 0;
      for (const h of segHoles) {
        const a = sideHoleScore(team_a, h.hole_number);
        const b = sideHoleScore(team_b, h.hole_number);
        // Skip holes still missing — keep counting later complete holes.
        if (a == null || b == null) continue;
        played++;
        if (a < b) aUp++;
        else if (b < a) aUp--;
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
