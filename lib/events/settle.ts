/**
 * Event-level settlement + field standings (Phase 3 of MULTI_GROUP_DESIGN.md).
 *
 * What this does
 * --------------
 * Per-round scoring is fully handled by the existing per-round engine
 * (lib/games/* + lib/scoring.ts). This module aggregates across N
 * foursomes (rounds) belonging to one event:
 *
 *   - Field standings: who's leading the event in gross/net across all
 *     foursomes, with per-player "thru X" (total holes scored across
 *     all their rounds in the event), rounds_played, rounds_finalized.
 *   - Field skins: per-hole min gross/net across the ENTIRE field —
 *     16 players in 4 foursomes all competing for the same skin pot.
 *   - Field stroke play: lowest total gross/net across the field wins
 *     the event-level stake.
 *
 * What this does NOT do
 * ---------------------
 *   - Field Nassau: doesn't extend cleanly to >2 sides without
 *     bracketing/pairing logic. Per the design doc, deferred.
 *   - Cross-foursome presses: presses STAY round-scoped. Real golf
 *     groups don't press between physically-separate foursomes.
 *   - Match-play variants of event games: not in scope; field events
 *     are stroke / skins by construction.
 *
 * Pure inputs, deterministic outputs. Same shape as the per-round
 * engine so the existing UI components (Leaderboard, SkinsPanel) can
 * render event-level results without rewrite.
 */
import { buildPlayerSheet } from "../scoring";
import { settleGame } from "../games";
import { addDelta, emptyOutput } from "../games/helpers";
import type {
  CourseHole,
  EventGame,
  GameOutput,
  GolfEvent,
  RoundPlayer,
  Score,
  UUID
} from "../types";

// ---------- Inputs ----------

export type EventRoundShape = {
  id: UUID;
  date: string;
  status: "draft" | "live" | "pending_finalization" | "finalized";
  holes: 9 | 18;
  course_id: UUID | null;
  course_name: string | null;
  course_holes: CourseHole[];
};

export type EventBundleInput = {
  event: GolfEvent;
  rounds: EventRoundShape[];
  /** Every round_player across every round in the event. */
  rps: RoundPlayer[];
  /** Every score across every round in the event. */
  scores: Score[];
  /** Field-wide games on the event itself. */
  event_games: EventGame[];
};

// ---------- Field standings output ----------

export type EventFieldPlayer = {
  player_id: UUID;
  display_name: string;
  /** Rounds the player is rostered in across the event (rps count). */
  rounds_rostered: number;
  /** Of those, how many are status='finalized'. */
  rounds_finalized: number;
  /** Total holes the player has scored across every round they're in. */
  thru_holes_total: number;
  /** Total holes the player is SCHEDULED to play across the event
   *  (sum of holes on each of their rounds). Lets the UI show "thru
   *  X of Y" instead of just "thru X". */
  thru_holes_expected: number;
  /** Sum of course par for the holes they've scored. */
  par_total_played: number;
  /** Sum of course par across every scheduled hole, played or not.
   *  Used for projected-finish-if-pars. */
  par_total_expected: number;
  /** Sum of gross scores across played holes. */
  total_gross: number;
  /** Sum of net scores across played holes. */
  total_net: number;
  /** total_gross - par_total_played. Negative = under par across the event. */
  vs_par_gross: number;
  /** total_net - par_total_played. */
  vs_par_net: number;
  /** Projected finish assuming the player pars every remaining hole.
   *  This is the FLOOR on their final score — the best case still
   *  achievable. Useful for "can Kyle catch Patrick?" type questions.
   *
   *  When the player has played every scheduled hole, this equals
   *  total_gross / total_net. */
  projected_gross_if_pars: number;
  projected_net_if_pars: number;
  /** Status:
   *   - "finished" — every scheduled hole has a gross score AND every
   *     round is finalized OR pending_finalization (live but scored)
   *   - "live" — has scored at least one hole, has holes remaining
   *   - "not_started" — no holes scored yet on any of their rounds
   */
  play_status: "finished" | "live" | "not_started";
};

export type EventFoursomeStatus = {
  round_id: UUID;
  date: string;
  course_name: string | null;
  status: "draft" | "live" | "pending_finalization" | "finalized";
  /** Highest hole_number scored by any player on this round. Reads as
   *  "thru X" — useful for spectator pace-of-play awareness. */
  thru_holes: number;
  total_holes: number;
  player_count: number;
};

export type EventFieldStandings = {
  players: EventFieldPlayer[]; // sorted by net asc, gross asc, name asc
  foursomes: EventFoursomeStatus[]; // sorted by status (live first), then date
};

// ---------- Field standings ----------

/**
 * Aggregate field standings across every round in the event.
 *
 * Algorithm:
 *   - For each round, build per-rp PlayerSheets using the existing
 *     per-round engine. This preserves per-round handicap allocation,
 *     stroke index, etc.
 *   - Group sheets by player_id (a player can appear in multiple
 *     rounds — e.g. multi-day trip).
 *   - Sum gross / net / thru / par-played across all their rounds.
 *   - Sort by net asc, gross asc, name asc.
 */
export function buildEventFieldStandings(
  input: EventBundleInput
): EventFieldStandings {
  // Index rps by round_id so we can build per-round sheets.
  const rpsByRound = new Map<UUID, RoundPlayer[]>();
  for (const rp of input.rps) {
    const arr = rpsByRound.get(rp.id /* placeholder; corrected below */);
    // RoundPlayer's round_id isn't on the type but the production data
    // includes it. We thread it through via the bundle's rps query —
    // see /events/[id]/leaderboard/page.tsx for the actual fetch.
    void arr;
  }
  // The RoundPlayer type doesn't expose round_id directly because it's
  // used by the per-round engine which already knows its round. For
  // event aggregation we need that field — the bundle's rps must
  // include it. We accept it through a side-channel: each rp's id is
  // the round_player_id, and the production fetch joins through
  // round_players to get the round_id.
  const rpRoundIdMap = new Map<UUID, UUID>(
    input.rps.map((rp) => [rp.id, (rp as any).round_id ?? ""])
  );

  // Per-round score lists.
  const scoresByRound = new Map<UUID, Score[]>();
  // Map rp.id → round_id so we can split scores by round
  // (scores are keyed on round_player_id only).
  const rpToRound = new Map<UUID, UUID>();
  for (const rp of input.rps) {
    const rid = (rp as any).round_id;
    if (rid) rpToRound.set(rp.id, rid);
  }
  for (const s of input.scores) {
    const rid = rpToRound.get(s.round_player_id);
    if (!rid) continue;
    const arr = scoresByRound.get(rid) ?? [];
    arr.push(s);
    scoresByRound.set(rid, arr);
  }

  // Build per-rp player sheets per round, then aggregate by player_id.
  type Acc = {
    display_name: string;
    rounds_rostered: number;
    rounds_finalized: number;
    thru_holes_total: number;
    thru_holes_expected: number;
    par_total_played: number;
    par_total_expected: number;
    total_gross: number;
    total_net: number;
    /** Net offset from gross for the holes already played. Used to
     *  derive net-if-pars (remaining holes contribute par + 0 net
     *  offset since strokes received apply per-hole and we don't
     *  re-allocate them for unplayed holes). For projected net we
     *  add (remaining_par + remaining_strokes_received) — we track
     *  the strokes-received per remaining hole separately. */
    remaining_net_par_adjustment: number;
  };
  const byPlayer = new Map<UUID, Acc>();

  for (const round of input.rounds) {
    const roundRps = input.rps.filter(
      (rp) => (rp as any).round_id === round.id
    );
    const roundScores = scoresByRound.get(round.id) ?? [];
    for (const rp of roundRps) {
      const sheet = buildPlayerSheet(rp, roundScores, round.course_holes);
      const acc = byPlayer.get(rp.player_id) ?? {
        display_name: rp.display_name,
        rounds_rostered: 0,
        rounds_finalized: 0,
        thru_holes_total: 0,
        thru_holes_expected: 0,
        par_total_played: 0,
        par_total_expected: 0,
        total_gross: 0,
        total_net: 0,
        remaining_net_par_adjustment: 0
      };
      acc.rounds_rostered += 1;
      if (round.status === "finalized") acc.rounds_finalized += 1;
      const playedRows = sheet.rows.filter((r) => r.gross != null);
      acc.thru_holes_total += playedRows.length;
      acc.thru_holes_expected += sheet.rows.length;
      acc.par_total_played += playedRows.reduce((s, r) => s + r.par, 0);
      acc.par_total_expected += sheet.rows.reduce((s, r) => s + r.par, 0);
      acc.total_gross += sheet.totals.gross;
      acc.total_net += sheet.totals.net;
      // Net-projection adjustment: for each remaining hole, the
      // player's projected NET on that hole if they par is
      // par - strokes_received. We sum (-strokes_received) across
      // remaining holes; "par-in" net contribution = remaining_par +
      // this sum.
      const remainingStrokes = sheet.rows
        .filter((r) => r.gross == null)
        .reduce((s, r) => s + r.strokes_received, 0);
      acc.remaining_net_par_adjustment += -remainingStrokes;
      byPlayer.set(rp.player_id, acc);
    }
  }

  const players: EventFieldPlayer[] = [...byPlayer.entries()].map(
    ([player_id, a]) => {
      const remaining_par = a.par_total_expected - a.par_total_played;
      const projected_gross_if_pars = a.total_gross + remaining_par;
      const projected_net_if_pars =
        a.total_net + remaining_par + a.remaining_net_par_adjustment;
      const play_status: EventFieldPlayer["play_status"] =
        a.thru_holes_total === 0
          ? "not_started"
          : a.thru_holes_total >= a.thru_holes_expected
          ? "finished"
          : "live";
      return {
        player_id,
        display_name: a.display_name,
        rounds_rostered: a.rounds_rostered,
        rounds_finalized: a.rounds_finalized,
        thru_holes_total: a.thru_holes_total,
        thru_holes_expected: a.thru_holes_expected,
        par_total_played: a.par_total_played,
        par_total_expected: a.par_total_expected,
        total_gross: a.total_gross,
        total_net: a.total_net,
        vs_par_gross: a.total_gross - a.par_total_played,
        vs_par_net: a.total_net - a.par_total_played,
        projected_gross_if_pars,
        projected_net_if_pars,
        play_status
      };
    }
  );
  players.sort((a, b) => {
    // Sort by net asc among those who have STARTED. Players who
    // haven't started yet sink to the bottom — keeps the leaderboard
    // readable when only some foursomes are out on the course.
    if (a.play_status === "not_started" && b.play_status !== "not_started")
      return 1;
    if (a.play_status !== "not_started" && b.play_status === "not_started")
      return -1;
    if (a.total_net !== b.total_net) return a.total_net - b.total_net;
    if (a.total_gross !== b.total_gross) return a.total_gross - b.total_gross;
    return a.display_name.localeCompare(b.display_name);
  });

  // Foursome status
  const foursomes: EventFoursomeStatus[] = input.rounds.map((r) => {
    const roundRps = input.rps.filter(
      (rp) => (rp as any).round_id === r.id
    );
    const roundScores = scoresByRound.get(r.id) ?? [];
    const maxHole = roundScores
      .filter((s) => s.gross != null)
      .reduce((max, s) => Math.max(max, s.hole_number), 0);
    return {
      round_id: r.id,
      date: r.date,
      course_name: r.course_name,
      status: r.status,
      thru_holes: maxHole,
      total_holes: r.holes,
      player_count: roundRps.length
    };
  });
  // Sort: live first, then pending, then draft, then finalized; within
  // each, by date ascending.
  const statusOrder: Record<string, number> = {
    live: 0,
    pending_finalization: 1,
    draft: 2,
    finalized: 3
  };
  foursomes.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    return a.date.localeCompare(b.date);
  });

  return { players, foursomes };
}

// ---------- Field-wide game settlement ----------

/**
 * Settle an event-level game across the entire field.
 *
 * Currently supported:
 *   - skins_gross / skins_net / skins_canadian — per-hole min across
 *     the field; ties carry per the existing skins engine.
 *   - individual_gross / individual_net — lowest total across the
 *     field wins the per-player stake from every other player.
 *
 * NOT supported (returns empty output with a console warning):
 *   - nassau / match_play / six_six_six / team games — these don't
 *     extend cleanly to a multi-foursome field without bracketing.
 *     Per the design doc, deferred.
 *
 * Returns the same GameOutput shape as per-round settleGame, so the
 * existing Leaderboard component renders event-level money identically
 * to round-level money.
 */
export function settleEventGame(
  game: EventGame,
  input: EventBundleInput
): GameOutput {
  const out = emptyOutput();
  const t = game.game_type;

  // Reject unsupported types — they'd produce misleading numbers.
  if (
    t === "nassau" ||
    t === "match_play" ||
    t === "six_six_six" ||
    t === "best_ball_gross" ||
    t === "best_ball_net" ||
    t === "aggregate_gross" ||
    t === "aggregate_net" ||
    t === "scramble_gross" ||
    t === "scramble_net"
  ) {
    // Match-play / team formats don't extend to a multi-foursome
    // field without explicit pairing. Return empty — UI shows a
    // "this game runs per-foursome" hint.
    return out;
  }

  // Build a virtual "field round" that combines every round in the
  // event into one logical round, then run the per-round engine on it.
  //
  // For skins: each hole NUMBER needs a shared notion of "lowest
  // score." Rounds at DIFFERENT courses share hole numbers but not
  // pars/SI — so we use the FIRST round's course_holes as the canonical
  // par. Per the design doc, field-wide skins typically happen at one
  // course (tournament / club game), and golf-trip events typically
  // run per-day skins not event-wide. The trip case will need a later
  // pass; for v1 we assume a single canonical course.
  if (input.rounds.length === 0) return out;
  const canonicalHoles =
    input.rounds[0].course_holes.length > 0
      ? input.rounds[0].course_holes
      : [];

  // Combine all rps + scores across rounds into a single virtual
  // round. round_player_id stays stable per (player, round) but a
  // player in two rounds gets two rp entries — that's correct for the
  // skins engine which compares per-rp scores per hole.
  const allRps = input.rps;
  const allScores = input.scores;

  // Validate hole alignment: if rounds are at different courses with
  // different par layouts (golf trip), event-wide skins gets weird.
  // For v1, we just use the canonical course's pars and trust the
  // commissioner won't run field skins across mismatched courses.
  // The Phase 3 UI will surface a warning in this case.

  // Per the engine, settleGame expects a single RoundGame. Synthesize
  // one from the event_game shape, plus a course (single par from the
  // canonical course's pars).
  const par = canonicalHoles.reduce((s, h) => s + h.par, 0);
  const totalHoles = (canonicalHoles.length >= 18 ? 18 : 9) as 9 | 18;

  const synthGame = {
    id: game.id,
    round_id: input.event.id, // synthetic — engine doesn't actually use it
    game_type: t,
    name: game.name,
    stake_cents: game.stake_cents,
    allowance_pct: game.allowance_pct,
    config: game.config
  };

  return settleGame({
    game: synthGame,
    players: allRps,
    scores: allScores,
    course: { holes: canonicalHoles, par },
    totalHoles,
    startingHole: 1
  });
}

// ---------- Convenience: render-ready bundle for the UI ----------

export function buildEventBundle(input: EventBundleInput): {
  standings: EventFieldStandings;
  game_outputs: Array<{ game: EventGame; output: GameOutput }>;
  per_player_event_money: Map<UUID, number>;
} {
  const standings = buildEventFieldStandings(input);
  const game_outputs = input.event_games.map((g) => ({
    game: g,
    output: settleEventGame(g, input)
  }));
  // Aggregate per-player money across all event games. Maps to
  // player_id (not round_player_id) so a player who's rostered in
  // multiple foursomes still gets one total.
  const per_player_event_money = new Map<UUID, number>();
  // rp_id → player_id lookup
  const rpToPlayer = new Map<UUID, UUID>(
    input.rps.map((rp) => [rp.id, rp.player_id])
  );
  for (const { output } of game_outputs) {
    for (const [rpId, delta] of output.perPlayer) {
      const playerId = rpToPlayer.get(rpId) ?? rpId;
      per_player_event_money.set(
        playerId,
        (per_player_event_money.get(playerId) ?? 0) + delta.delta_cents
      );
    }
  }
  return { standings, game_outputs, per_player_event_money };
}

// Re-export helper for caller convenience
export { addDelta };
