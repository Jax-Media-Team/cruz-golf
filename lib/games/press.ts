/**
 * Press detection — pure, generic module for any match-play-style game.
 *
 * A "press" is a side-bet that opens automatically (or manually) when one
 * side is down by N holes during a match-play segment. The press is its
 * own mini-match starting from the trigger hole, with the same stake as
 * the parent segment, settling at the segment's end.
 *
 * Today only Nassau exposes a `presses` config, but only as a flag —
 * the settlement code never actually computed press chains. This module
 * makes presses real:
 *   - Nassau (front / back / overall) → opt-in auto_2_down
 *   - Best Ball / Aggregate / Scramble → wire-up TBD (same shape: pass
 *     a per-hole match-play result list and a stake)
 *   - 6-6-6 → each segment can opt in independently
 *
 * Pure inputs, deterministic outputs, testable in isolation. No DB,
 * no React, no Supabase.
 */

export type HoleResult = {
  /** 1-based hole number within the round (used as a stable key). */
  hole_number: number;
  /** True when side A won this hole outright (lower score). */
  a_won: boolean;
  /** True when side B won this hole outright. */
  b_won: boolean;
  /** True when both sides were equal (push). */
  push: boolean;
  /** True when at least one side has no score yet — match-play
   *  contribution is 0 for incomplete holes. */
  incomplete: boolean;
};

export type PressMatch = {
  /** Stable label, e.g. "Nassau front · press 1". */
  label: string;
  /** Parent segment's label so consumers can group presses correctly. */
  segment_label: string;
  /** First hole the press covers (the hole AFTER the trigger event). */
  start_hole: number;
  /** Last hole the press covers (inclusive — segment's last hole). */
  end_hole: number;
  /** Stake in cents — equal to parent segment's stake. */
  stake_cents: number;
  /** Trigger hole — where the press opened. */
  trigger_hole: number;
  /** Cumulative match-play delta from A's perspective at trigger
   *  (always negative when A is down enough to open a press). */
  trigger_delta: number;
  /** Outcome at segment end: positive = A won, negative = B won, 0 = push,
   *  null = press hadn't completed by the time scores ran out. */
  result_delta: number | null;
};

export type PressOpts = {
  /** "Down" threshold to auto-open a press. Default 2. */
  triggerDown?: number;
  /** Minimum holes that must remain in the segment for a press to
   *  open. Default 3 — prevents tiny presses on the last few holes. */
  minRemainingHoles?: number;
  /** Cap on number of presses per segment. Default 4 — protects against
   *  pathological back-and-forth in a runaway match. */
  maxPresses?: number;
  /** Stake for each press (matches the parent segment's stake). */
  stakeCents: number;
  /** Label used in returned PressMatch.segment_label. */
  segmentLabel: string;
  /** First hole index in the segment (0-based into `holes`). */
  segmentStart: number;
  /** End index (exclusive) of the segment. */
  segmentEnd: number;
};

/**
 * Detect auto-presses (trigger at N-down) for a single match-play
 * segment. Returns one PressMatch per press opened.
 *
 * Algorithm:
 *   - Walk holes in order, accumulating A's match-play delta.
 *   - When delta ≤ -triggerDown AND segment has ≥ minRemainingHoles
 *     left AND no press is currently open trailing in that direction,
 *     open a press starting at the NEXT hole.
 *   - When delta ≥ +triggerDown, do the same in B's direction.
 *   - A new press only opens after any active press in that direction
 *     has settled (or been overtaken).
 *   - At segment end, each press settles based on its own A-delta
 *     across the holes it covered.
 *
 * Note: "auto-press at 2 down" is the most common rule. Manual presses
 * (commissioner adds mid-round) are NOT covered by this function; they'd
 * be authored via separate UI and stored as round_games rows.
 */
export function detectAutoPresses(
  holes: HoleResult[],
  opts: PressOpts
): PressMatch[] {
  const triggerDown = opts.triggerDown ?? 2;
  const minRemaining = opts.minRemainingHoles ?? 3;
  const maxPresses = opts.maxPresses ?? 4;

  const segmentHoles = holes.slice(opts.segmentStart, opts.segmentEnd);
  if (segmentHoles.length === 0) return [];

  type ActivePress = {
    direction: -1 | 1; // -1 = opened when A was down; +1 = B was down
    startIdx: number; // index within segmentHoles where press starts
    triggerHole: number;
    triggerDelta: number;
  };
  const presses: PressMatch[] = [];
  const active: ActivePress[] = [];

  let cumulativeDelta = 0;

  for (let i = 0; i < segmentHoles.length; i++) {
    const h = segmentHoles[i];
    if (!h.incomplete) {
      if (h.a_won) cumulativeDelta += 1;
      else if (h.b_won) cumulativeDelta -= 1;
      // push: 0
    }

    // Consider opening a NEW press based on current delta. We only open
    // one press per direction at a time — wait until the previous one
    // in that direction would have settled (we use a simple "no active
    // press in that direction" check, since each press's outcome is
    // computed at segment end).
    const remaining = segmentHoles.length - (i + 1);
    if (presses.length + active.length >= maxPresses) continue;

    const direction: -1 | 1 | 0 =
      cumulativeDelta <= -triggerDown
        ? -1
        : cumulativeDelta >= triggerDown
        ? 1
        : 0;
    if (direction === 0) continue;
    if (remaining < minRemaining) continue;
    // Don't open another press in the same direction if one is already open.
    if (active.some((p) => p.direction === direction)) continue;

    active.push({
      direction,
      startIdx: i + 1,
      triggerHole: h.hole_number,
      triggerDelta: cumulativeDelta
    });
  }

  // Settle each opened press: compute the A-delta over the holes it covered.
  for (const a of active) {
    const pressHoles = segmentHoles.slice(a.startIdx);
    let pressDelta = 0;
    let allComplete = true;
    for (const h of pressHoles) {
      if (h.incomplete) {
        allComplete = false;
        continue;
      }
      if (h.a_won) pressDelta += 1;
      else if (h.b_won) pressDelta -= 1;
    }
    presses.push({
      label: `${opts.segmentLabel} · press ${
        presses.filter((p) => p.segment_label === opts.segmentLabel).length + 1
      }`,
      segment_label: opts.segmentLabel,
      start_hole: pressHoles[0]?.hole_number ?? a.triggerHole + 1,
      end_hole: pressHoles[pressHoles.length - 1]?.hole_number ?? a.triggerHole,
      stake_cents: opts.stakeCents,
      trigger_hole: a.triggerHole,
      trigger_delta: a.triggerDelta,
      result_delta: allComplete ? pressDelta : null
    });
  }

  return presses;
}

/**
 * Manual press — a press opened explicitly by a player during a round
 * (rather than auto-fired by detectAutoPresses). Stored in the
 * `round_presses` DB table; settlement reads accepted rows and runs
 * them through `settleManualPress()` below at finalize time.
 *
 * Sides A and B are stored as round_player_id arrays at open time and
 * persist for settlement. This is important for 6-6-6 where partner
 * pairings rotate per segment — the settlement engine doesn't have to
 * re-derive who was paired with whom; it's frozen at press-open time.
 */
export type ManualPress = {
  /** Stable id from the DB row. */
  id: string;
  segment_label: string;
  start_hole: number;
  end_hole: number;
  stake_cents: number;
  /** Round-player ids on each side. Order doesn't matter; settlement
   *  treats sets, not arrays. */
  side_a_rp_ids: string[];
  side_b_rp_ids: string[];
};

/**
 * Settle a single manual press given the per-hole results from A's
 * perspective. Matches the shape of detectAutoPresses output so the
 * downstream pressPotsBySide() can apply manual + auto presses
 * uniformly.
 *
 * Pushes contribute 0 to the press delta. Incomplete holes contribute
 * 0 too — but if ANY hole in [start_hole, end_hole] is incomplete, the
 * press is unsettled (result_delta = null). This matches the auto-press
 * convention and means manual presses only settle when the entire
 * covered range has scores.
 */
export function settleManualPress(
  press: ManualPress,
  holes: HoleResult[]
): PressMatch {
  const inRange = holes.filter(
    (h) => h.hole_number >= press.start_hole && h.hole_number <= press.end_hole
  );
  let delta = 0;
  let allComplete = true;
  for (const h of inRange) {
    if (h.incomplete) {
      allComplete = false;
      continue;
    }
    if (h.a_won) delta += 1;
    else if (h.b_won) delta -= 1;
  }
  return {
    label: `${press.segment_label} · manual press`,
    segment_label: press.segment_label,
    start_hole: press.start_hole,
    end_hole: press.end_hole,
    stake_cents: press.stake_cents,
    trigger_hole: press.start_hole - 1, // synthesized for compatibility
    trigger_delta: 0, // n/a for manual
    result_delta: allComplete ? delta : null
  };
}

/**
 * Convenience: aggregate per-side cents won/lost across a list of
 * settled presses. Pushes (delta=0) and unsettled presses (delta=null)
 * contribute zero. Mirrors the side-pot distribution rule used by
 * Nassau segments — everyone on the losing side pays stake; pot
 * splits among winners, remainder goes to the first sorted winner id.
 */
export function pressPotsBySide(
  presses: PressMatch[],
  sideA: string[],
  sideB: string[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of [...sideA, ...sideB]) out.set(id, 0);
  for (const p of presses) {
    if (p.result_delta == null || p.result_delta === 0) continue;
    const aWon = p.result_delta > 0;
    const winners = aWon ? sideA : sideB;
    const losers = aWon ? sideB : sideA;
    if (winners.length === 0 || losers.length === 0) continue;
    const pot = p.stake_cents * losers.length;
    for (const id of losers) out.set(id, (out.get(id) ?? 0) - p.stake_cents);
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    const sorted = [...winners].sort();
    sorted.forEach((id, i) => {
      out.set(id, (out.get(id) ?? 0) + each + (i < remainder ? 1 : 0));
    });
  }
  return out;
}
