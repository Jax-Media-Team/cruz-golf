/**
 * Live match state — pure helper that answers
 *   "What is happening in the match right now?"
 * for any team-format game.
 *
 * The settlement engine (lib/games/index.ts and its variants) only
 * exposes per-player cents deltas — the money outcome. That's the
 * right contract for finalize/audit. But during a live round, players
 * want to see things like:
 *   - Nassau front: A up 1 thru 6
 *   - 6-6-6 seg 2 (Pat+Mit vs Ben+Kyl): Tied thru 3
 *   - Best Ball: Pat+Ben -3 thru 12 vs Mit+Kyl -1
 * That match-state isn't visible anywhere today, even though the
 * engine internally computes it during settlement and then discards
 * it. This function exposes the same data without re-running the
 * payout logic.
 *
 * Pure inputs, deterministic outputs, no React / no Supabase. Tested
 * in isolation. Consumers (the round-view leaderboard's Team / Match
 * tab) call this once per team game on the round and render the
 * returned segments.
 */
import { buildPlayerSheet } from "../scoring";
import { applyAllowance, holesInPlay } from "./helpers";
import type { GameInput, GameType, RoundPlayer, UUID } from "../types";

export type LiveSide = {
  player_ids: UUID[];
  /** Human-readable label, e.g. "Pat + Ben" or "Patrick" for solo. */
  label: string;
};

export type LiveSegment = {
  /** Display label, e.g. "Nassau front", "Seg 1 (1-6)". */
  segment_label: string;
  /** Inclusive hole range covered by this segment. */
  start_hole: number;
  end_hole: number;
  /** Total holes in the segment. */
  total_holes: number;
  /** Holes where BOTH sides have a score. */
  holes_played: number;
  side_a: LiveSide;
  side_b: LiveSide;
  /** Whether this segment uses match-play scoring. False = stroke play. */
  match_play: boolean;
  /** Match-play data — only meaningful when match_play=true. */
  a_holes_won: number;
  b_holes_won: number;
  pushes: number;
  /** Signed: positive = side A leads, negative = side B leads, 0 = tied. */
  a_up: number;
  /** Stroke-play totals — only meaningful when match_play=false. */
  a_total: number;
  b_total: number;
  /** Holes remaining in the segment (total - played). */
  remaining: number;
  /**
   * Match-play extras:
   *   - "dormie" — leading side's lead == remaining (can't lose, can only tie)
   *   - "closed_out_by_a" — match is mathematically over, side A won
   *   - "closed_out_by_b" — same, side B won
   *   - null — neither
   * Only set when match_play=true and the segment isn't fully played.
   */
  dormie_or_closed: "dormie" | "closed_out_by_a" | "closed_out_by_b" | null;
};

export type LiveMatchState = {
  game_id: UUID;
  game_name: string;
  game_type: GameType;
  /** Categorizes the rendering UI:
   *   - "nassau" — 3 segments (front/back/overall on 18, 1 segment on 9)
   *   - "six_six_six" — 3 segments with rotating partner pairs
   *   - "team_match" — 1 segment, match-play, best ball/aggregate/scramble
   *   - "team_stroke" — 1 segment, stroke-play team (sum of best balls)
   *   - "individual" — no team match state; UI should skip
   *   - "skins" — no segments; UI shows skins panel
   */
  variant:
    | "nassau"
    | "six_six_six"
    | "team_match"
    | "team_stroke"
    | "individual"
    | "skins";
  segments: LiveSegment[];
};

// ===== Public entry point ============================================

export function buildLiveMatchState(input: GameInput): LiveMatchState | null {
  const t = input.game.game_type;
  switch (t) {
    case "nassau":
    case "match_play":
      return buildNassauState(input);
    case "six_six_six":
      return buildSixSixSixState(input);
    case "best_ball_gross":
    case "best_ball_net":
    case "aggregate_gross":
    case "aggregate_net":
    case "scramble_gross":
    case "scramble_net":
      return buildTeamGameState(input);
    case "individual_gross":
    case "individual_net":
    case "skins_gross":
    case "skins_net":
    case "skins_canadian":
    case "ctp":
    case "long_drive":
    case "custom":
      return null; // not a team match — UI uses other panels
    default:
      // Exhaustiveness: TS narrows t to `never` if all cases handled.
      return null;
  }
}

// ===== Side labels ===================================================

function nameOf(players: RoundPlayer[], id: UUID): string {
  return players.find((p) => p.id === id)?.display_name ?? "—";
}

function labelSide(players: RoundPlayer[], ids: UUID[]): string {
  return ids.map((id) => nameOf(players, id)).join(" + ");
}

// ===== Nassau (front/back/overall on 18, 1 segment on 9) ============

function buildNassauState(input: GameInput): LiveMatchState | null {
  const cfg = (input.game.config ?? {}) as {
    net?: boolean;
    match_play?: boolean;
    front_stake_cents?: number;
    back_stake_cents?: number;
    overall_stake_cents?: number;
  };
  const useNet = cfg.net ?? true;
  const matchPlay = cfg.match_play ?? true;

  // Determine sides — same rule as settleNassau:
  // teams if present, else first-two players head-to-head.
  const teamMap = new Map<UUID, UUID[]>();
  for (const p of input.players) {
    if (p.team_id) {
      const arr = teamMap.get(p.team_id) ?? [];
      arr.push(p.id);
      teamMap.set(p.team_id, arr);
    }
  }
  let sideAIds: UUID[];
  let sideBIds: UUID[];
  if (teamMap.size >= 2) {
    const teamIds = [...teamMap.keys()];
    sideAIds = teamMap.get(teamIds[0])!;
    sideBIds = teamMap.get(teamIds[1])!;
  } else if (input.players.length >= 2) {
    sideAIds = [input.players[0].id];
    sideBIds = [input.players[1].id];
  } else {
    return null;
  }

  const adjusted = useNet
    ? applyAllowance(input.players, input.game.allowance_pct)
    : input.players;
  const sheets = new Map(
    adjusted.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const holes = holesInPlay(input);
  const total = holes.length;

  const sideHoleScore = (side: UUID[], holeIdx: number): number | null => {
    const arr: number[] = [];
    for (const pid of side) {
      const row = sheets.get(pid)?.rows.find(
        (r) => r.hole_number === holes[holeIdx].hole_number
      );
      const v = useNet ? row?.net : row?.gross;
      if (v == null) return null;
      arr.push(v);
    }
    return Math.min(...arr);
  };

  function makeSegment(
    label: string,
    startIdx: number,
    endIdx: number
  ): LiveSegment {
    let aWon = 0;
    let bWon = 0;
    let pushes = 0;
    let aTotal = 0;
    let bTotal = 0;
    let holes_played = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const a = sideHoleScore(sideAIds, i);
      const b = sideHoleScore(sideBIds, i);
      if (a == null || b == null) continue;
      holes_played += 1;
      aTotal += a;
      bTotal += b;
      if (a < b) aWon += 1;
      else if (b < a) bWon += 1;
      else pushes += 1;
    }
    const total_holes = endIdx - startIdx;
    const remaining = total_holes - holes_played;
    const a_up = matchPlay ? aWon - bWon : bTotal - aTotal;
    let dormie_or_closed: LiveSegment["dormie_or_closed"] = null;
    if (matchPlay && remaining > 0) {
      const absLead = Math.abs(a_up);
      if (absLead > remaining) {
        dormie_or_closed = a_up > 0 ? "closed_out_by_a" : "closed_out_by_b";
      } else if (absLead === remaining && absLead > 0) {
        dormie_or_closed = "dormie";
      }
    }
    return {
      segment_label: label,
      start_hole: holes[startIdx]?.hole_number ?? startIdx + 1,
      end_hole: holes[endIdx - 1]?.hole_number ?? endIdx,
      total_holes,
      holes_played,
      side_a: { player_ids: sideAIds, label: labelSide(input.players, sideAIds) },
      side_b: { player_ids: sideBIds, label: labelSide(input.players, sideBIds) },
      match_play: matchPlay,
      a_holes_won: aWon,
      b_holes_won: bWon,
      pushes,
      a_up,
      a_total: aTotal,
      b_total: bTotal,
      remaining,
      dormie_or_closed
    };
  }

  const segments: LiveSegment[] = [];
  if (total === 9) {
    segments.push(makeSegment("Nassau 9", 0, 9));
  } else if (total >= 18) {
    segments.push(makeSegment("Nassau front", 0, 9));
    segments.push(makeSegment("Nassau back", 9, 18));
    segments.push(makeSegment("Nassau overall", 0, 18));
  } else if (total > 0) {
    segments.push(makeSegment("Nassau", 0, total));
  }

  return {
    game_id: input.game.id,
    game_name: input.game.name,
    game_type: input.game.game_type,
    variant: "nassau",
    segments
  };
}

// ===== 6-6-6 (3 segments with rotating pairs) =======================

function buildSixSixSixState(input: GameInput): LiveMatchState | null {
  if (input.players.length !== 4) return null;
  const cfg = (input.game.config ?? {}) as {
    rotation?: Array<{ team_a: [UUID, UUID]; team_b: [UUID, UUID] }>;
    net?: boolean;
    match_play?: boolean;
  };
  const useNet = cfg.net ?? true;
  const matchPlay = cfg.match_play ?? true;

  const ids = input.players.map((p) => p.id);
  const rotation =
    cfg.rotation ?? [
      { team_a: [ids[0], ids[1]] as [UUID, UUID], team_b: [ids[2], ids[3]] as [UUID, UUID] },
      { team_a: [ids[0], ids[2]] as [UUID, UUID], team_b: [ids[1], ids[3]] as [UUID, UUID] },
      { team_a: [ids[0], ids[3]] as [UUID, UUID], team_b: [ids[1], ids[2]] as [UUID, UUID] }
    ];

  const adjusted = useNet
    ? applyAllowance(input.players, input.game.allowance_pct)
    : input.players;
  const sheets = new Map(
    adjusted.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const holes = holesInPlay(input);
  if (holes.length !== 18) return null;

  const sideScore = (side: [UUID, UUID], holeIdx: number): number | null => {
    const arr: number[] = [];
    for (const pid of side) {
      const row = sheets.get(pid)?.rows.find(
        (r) => r.hole_number === holes[holeIdx].hole_number
      );
      const v = useNet ? row?.net : row?.gross;
      if (v == null) return null;
      arr.push(v);
    }
    return Math.min(...arr);
  };

  const segments: LiveSegment[] = rotation.map((seg, segIdx) => {
    const startIdx = segIdx * 6;
    const endIdx = startIdx + 6;
    let aWon = 0;
    let bWon = 0;
    let pushes = 0;
    let aTotal = 0;
    let bTotal = 0;
    let holes_played = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const a = sideScore(seg.team_a, i);
      const b = sideScore(seg.team_b, i);
      if (a == null || b == null) continue;
      holes_played += 1;
      aTotal += a;
      bTotal += b;
      if (a < b) aWon += 1;
      else if (b < a) bWon += 1;
      else pushes += 1;
    }
    const total_holes = 6;
    const remaining = total_holes - holes_played;
    const a_up = matchPlay ? aWon - bWon : bTotal - aTotal;
    let dormie_or_closed: LiveSegment["dormie_or_closed"] = null;
    if (matchPlay && remaining > 0) {
      const absLead = Math.abs(a_up);
      if (absLead > remaining) {
        dormie_or_closed = a_up > 0 ? "closed_out_by_a" : "closed_out_by_b";
      } else if (absLead === remaining && absLead > 0) {
        dormie_or_closed = "dormie";
      }
    }
    return {
      segment_label: `Seg ${segIdx + 1} (${startIdx + 1}-${endIdx})`,
      start_hole: startIdx + 1,
      end_hole: endIdx,
      total_holes,
      holes_played,
      side_a: { player_ids: [...seg.team_a], label: labelSide(input.players, seg.team_a) },
      side_b: { player_ids: [...seg.team_b], label: labelSide(input.players, seg.team_b) },
      match_play: matchPlay,
      a_holes_won: aWon,
      b_holes_won: bWon,
      pushes,
      a_up,
      a_total: aTotal,
      b_total: bTotal,
      remaining,
      dormie_or_closed
    };
  });

  return {
    game_id: input.game.id,
    game_name: input.game.name,
    game_type: input.game.game_type,
    variant: "six_six_six",
    segments
  };
}

// ===== Best ball / Aggregate / Scramble (single-segment team game) ==

function buildTeamGameState(input: GameInput): LiveMatchState | null {
  const cfg = (input.game.config ?? {}) as { match_play?: boolean };
  const matchPlay = cfg.match_play === true;
  const t = input.game.game_type;
  const isAggregate = t === "aggregate_gross" || t === "aggregate_net";
  const isScramble = t === "scramble_gross" || t === "scramble_net";
  const useNet = t.endsWith("_net");

  // Form teams from team_id.
  const teamMap = new Map<UUID, UUID[]>();
  for (const p of input.players) {
    if (p.team_id) {
      const arr = teamMap.get(p.team_id) ?? [];
      arr.push(p.id);
      teamMap.set(p.team_id, arr);
    }
  }
  if (teamMap.size < 2) return null;
  const teamIds = [...teamMap.keys()];
  const sideAIds = teamMap.get(teamIds[0])!;
  const sideBIds = teamMap.get(teamIds[1])!;

  const adjusted = useNet
    ? applyAllowance(input.players, input.game.allowance_pct)
    : input.players;
  const sheets = new Map(
    adjusted.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const holes = holesInPlay(input);

  const sideScore = (
    sideIds: UUID[],
    holeIdx: number
  ): number | null => {
    const arr: number[] = [];
    let allMembersScored = true;
    for (const pid of sideIds) {
      const row = sheets.get(pid)?.rows.find(
        (r) => r.hole_number === holes[holeIdx].hole_number
      );
      const v = useNet ? row?.net : row?.gross;
      if (v == null) {
        allMembersScored = false;
      } else {
        arr.push(v);
      }
    }
    // For scramble, one entry per team is enough (matches the
    // engine relaxation from SCRAMBLE-ONE-ENTRY).
    const complete = isScramble ? arr.length > 0 : allMembersScored;
    if (!complete) return null;
    return isAggregate ? arr.reduce((a, b) => a + b, 0) : Math.min(...arr);
  };

  let aWon = 0;
  let bWon = 0;
  let pushes = 0;
  let aTotal = 0;
  let bTotal = 0;
  let holes_played = 0;
  for (let i = 0; i < holes.length; i++) {
    const a = sideScore(sideAIds, i);
    const b = sideScore(sideBIds, i);
    if (a == null || b == null) continue;
    holes_played += 1;
    aTotal += a;
    bTotal += b;
    if (a < b) aWon += 1;
    else if (b < a) bWon += 1;
    else pushes += 1;
  }
  const total_holes = holes.length;
  const remaining = total_holes - holes_played;
  const a_up = matchPlay ? aWon - bWon : bTotal - aTotal;
  let dormie_or_closed: LiveSegment["dormie_or_closed"] = null;
  if (matchPlay && remaining > 0) {
    const absLead = Math.abs(a_up);
    if (absLead > remaining) {
      dormie_or_closed = a_up > 0 ? "closed_out_by_a" : "closed_out_by_b";
    } else if (absLead === remaining && absLead > 0) {
      dormie_or_closed = "dormie";
    }
  }
  return {
    game_id: input.game.id,
    game_name: input.game.name,
    game_type: t,
    variant: matchPlay ? "team_match" : "team_stroke",
    segments: [
      {
        segment_label: input.game.name,
        start_hole: holes[0]?.hole_number ?? 1,
        end_hole: holes[holes.length - 1]?.hole_number ?? total_holes,
        total_holes,
        holes_played,
        side_a: { player_ids: sideAIds, label: labelSide(input.players, sideAIds) },
        side_b: { player_ids: sideBIds, label: labelSide(input.players, sideBIds) },
        match_play: matchPlay,
        a_holes_won: aWon,
        b_holes_won: bWon,
        pushes,
        a_up,
        a_total: aTotal,
        b_total: bTotal,
        remaining,
        dormie_or_closed
      }
    ]
  };
}

// ===== Display helpers (used by the leaderboard UI) =================

/**
 * Human-readable status line for a segment. Examples:
 *   "Pat + Ben up 2 thru 6"
 *   "Tied thru 4"
 *   "Pat + Ben dormie · 3 to play"
 *   "Pat + Ben closed it out 3 & 2"
 *   "Pat + Ben −2 vs Mit + Kyl E · 12 played"  (stroke play)
 *   "Not started"
 */
export function fmtSegmentStatus(s: LiveSegment): string {
  if (s.holes_played === 0) return "Not started";
  if (s.match_play) {
    if (s.dormie_or_closed === "dormie") {
      const leader = s.a_up > 0 ? s.side_a.label : s.side_b.label;
      return `${leader} dormie · ${s.remaining} to play`;
    }
    if (s.dormie_or_closed === "closed_out_by_a") {
      return `${s.side_a.label} closed out · ${Math.abs(s.a_up)} & ${s.remaining}`;
    }
    if (s.dormie_or_closed === "closed_out_by_b") {
      return `${s.side_b.label} closed out · ${Math.abs(s.a_up)} & ${s.remaining}`;
    }
    if (s.a_up === 0) return `Tied thru ${s.holes_played}`;
    const leader = s.a_up > 0 ? s.side_a.label : s.side_b.label;
    const margin = Math.abs(s.a_up);
    const tail =
      s.holes_played === s.total_holes
        ? `· ${margin} up at the end`
        : `· thru ${s.holes_played}`;
    return `${leader} up ${margin} ${tail}`;
  }
  // Stroke play
  const diff = s.b_total - s.a_total;
  if (diff === 0) return `Tied · ${s.holes_played} played`;
  const leader = diff > 0 ? s.side_a.label : s.side_b.label;
  return `${leader} −${Math.abs(diff)} · ${s.holes_played} played`;
}
