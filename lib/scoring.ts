import type {
  CourseHole,
  RoundPlayer,
  Score,
  UUID,
  ScoreCapMode
} from "./types";
import { applyCap, netForHole, strokesPerHole } from "./handicap";

export type PlayerHoleResult = {
  hole_number: number;
  par: number;
  stroke_index: number;
  strokes_received: number;
  gross: number | null;
  net: number | null;
  capped_gross: number | null; // for handicap-related calcs
};

export type PlayerSheet = {
  round_player_id: UUID;
  display_name: string;
  team_id: UUID | null;
  rows: PlayerHoleResult[];
  totals: { gross: number; net: number; thru: number; vsPar: number };
};

export function buildPlayerSheet(
  rp: RoundPlayer,
  scores: Score[],
  holes: CourseHole[],
  capMode: ScoreCapMode = "none"
): PlayerSheet {
  const ordered = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const strokes = strokesPerHole(rp.playing_handicap, ordered);
  const byHole = new Map<number, Score>();
  for (const s of scores) {
    if (s.round_player_id === rp.id) byHole.set(s.hole_number, s);
  }

  let grossTotal = 0;
  let netTotal = 0;
  let thru = 0;
  let parTotalOfPlayed = 0;
  const rows: PlayerHoleResult[] = ordered.map((h, i) => {
    const sc = byHole.get(h.hole_number);
    const gross = sc?.gross ?? null;
    const sr = strokes[i];
    let capped: number | null = null;
    let net: number | null = null;
    if (gross != null) {
      capped = applyCap(gross, h.par, sr, capMode);
      net = netForHole(capped, sr);
      grossTotal += gross;
      netTotal += net;
      thru = h.hole_number;
      parTotalOfPlayed += h.par;
    }
    return {
      hole_number: h.hole_number,
      par: h.par,
      stroke_index: h.stroke_index,
      strokes_received: sr,
      gross,
      net,
      capped_gross: capped
    };
  });

  return {
    round_player_id: rp.id,
    display_name: rp.display_name,
    team_id: rp.team_id,
    rows,
    totals: {
      gross: grossTotal,
      net: netTotal,
      thru,
      vsPar: grossTotal - parTotalOfPlayed
    }
  };
}

export type LeaderboardRow = {
  position: number;
  round_player_id: UUID;
  display_name: string;
  thru: number;
  gross: number;
  net: number;
  vsPar: number;
  /** Front-9 gross (only including holes already played). */
  front: number | null;
  /** Back-9 gross (only including holes already played). */
  back: number | null;
};

function splitNines(sheet: PlayerSheet): { front: number | null; back: number | null } {
  let frontPlayed = 0;
  let frontSum = 0;
  let backPlayed = 0;
  let backSum = 0;
  for (const r of sheet.rows) {
    if (r.gross == null) continue;
    if (r.hole_number <= 9) {
      frontPlayed += 1;
      frontSum += r.gross;
    } else {
      backPlayed += 1;
      backSum += r.gross;
    }
  }
  return {
    front: frontPlayed > 0 ? frontSum : null,
    back: backPlayed > 0 ? backSum : null
  };
}

export function leaderboard(sheets: PlayerSheet[], mode: "gross" | "net"): LeaderboardRow[] {
  const rows = sheets
    .map((s) => {
      const { front, back } = splitNines(s);
      return {
        round_player_id: s.round_player_id,
        display_name: s.display_name,
        thru: s.totals.thru,
        gross: s.totals.gross,
        net: s.totals.net,
        vsPar: s.totals.vsPar,
        front,
        back
      };
    })
    .sort((a, b) => {
      const aKey = mode === "gross" ? a.gross : a.net;
      const bKey = mode === "gross" ? b.gross : b.net;
      if (aKey !== bKey) return aKey - bKey;
      return b.thru - a.thru; // farther through wins tiebreak
    });

  let lastKey: number | null = null;
  let lastPos = 0;
  return rows.map((r, idx) => {
    const key = mode === "gross" ? r.gross : r.net;
    const pos = key === lastKey ? lastPos : idx + 1;
    lastKey = key;
    lastPos = pos;
    return { position: pos, ...r };
  });
}
