/**
 * Junk side-bet engine.
 *
 * "Junk" is the umbrella term for side bets golfers tap onto a normal
 * money game: birdies, greenies, sandies, barkies, chip-ins, etc.
 * The bets are FLAT (every junk pays a fixed $X) or ESCALATING (the
 * pot grows as more junk is recorded — common "we play $2 escalating
 * junk" rule).
 *
 * Design constraints from the real-world ask:
 *
 *   - "Tap the extra things that happened on the hole" — not
 *     accounting software. The engine takes a flat list of recorded
 *     items and produces per-player cents deltas. The UI is a quick
 *     tap surface (Patrick / hole 7 / birdie → done).
 *
 *   - Each junk item's payout is computed at RECORD time, not at
 *     settle time. Once recorded, the amount is frozen. This matters
 *     for the escalating mode: if Pat hit a birdie on hole 4 when the
 *     escalation step was $2, his birdie pays $2 regardless of how
 *     many subsequent items show up. (Same reasoning as a stock-market
 *     fill — the price is set when the order goes through.) Pure
 *     function: same inputs produce same outputs, no race conditions.
 *
 *   - Standard payout rule: winner gets `amount_cents` from EACH OTHER
 *     player in the round. So with 4 players and a $2 junk, the
 *     winner gets +$6 and each other player pays $2. Zero-sum. This is
 *     the universal casual-golf convention; pot-based junk (everyone
 *     pre-funds a pot) can be added later as a config mode.
 *
 *   - Engine is "thin": the schema, RPCs, UI, and audit layer wrap
 *     it. This file is what we test in isolation.
 *
 * No DB, no React, no Supabase. Vitest-only deps.
 */
import type { UUID } from "../types";

/**
 * Built-in junk categories. Extending the list is additive — adding
 * a new value here doesn't break existing rounds (their items keep
 * the old category strings). For one-off group-specific bets the
 * `custom` category is the seam.
 */
export type JunkCategory =
  | "birdie"
  | "eagle"
  | "greenie" // closest to pin on a par 3 in regulation
  | "poley" // make a putt of a certain length / from off the green; rules vary
  | "pinnie" // hit the flagstick on approach (some groups)
  | "sandy" // par or better from a greenside bunker
  | "barkie" // par or better after hitting a tree
  | "chip_in" // hole out from off the green
  | "net_birdie" // birdie counting handicap strokes
  | "custom";

export type JunkItem = {
  id: string;
  /** Winner — gets paid by everyone else. */
  player_id: UUID;
  hole_number: number;
  category: JunkCategory;
  /** Required when category === "custom" — the group-specific label
   *  ("woodie", "Wilson special", whatever). Otherwise optional /
   *  informational. */
  custom_label?: string;
  /** The frozen payout amount in cents. Set at record time via
   *  computeJunkAmount() and persisted with the item. Once written
   *  it never changes — settlement just sums it. */
  amount_cents: number;
  /** ISO timestamp. Used for ordering escalation history. */
  created_at: string;
  /** Optional note from the scorer ("from greenside bunker, 8ft"). */
  note?: string;
};

export type JunkConfig = {
  /** Categories the commissioner enabled for this round. Items
   *  recorded outside this set are still settled (frozen amount),
   *  but new items can only be recorded for active categories. */
  active_categories: JunkCategory[];
  /** Flat: every junk pays `flat_amount_cents` regardless of order.
   *  Escalating: payouts climb as more junk gets recorded. */
  mode: "flat" | "escalating";
  /** Used in flat mode. */
  flat_amount_cents?: number;
  /** First item's payout in escalating mode. */
  base_amount_cents?: number;
  /** Step added per prior item in escalating mode. With base=200 +
   *  step=200, the sequence is $2 → $4 → $6 → $8... ("$2 escalating"). */
  escalation_step_cents?: number;
  /** How escalation counts prior items:
   *   - "per_round" — every junk item in the round (most common; the
   *     mental model: "the pot grows every time anyone gets junk").
   *   - "per_category" — each category escalates independently
   *     ("birdies escalate, greenies escalate, separately").
   *   - "per_player_per_category" — each player's repeats in a single
   *     category escalate (less common; deters one hot player from
   *     ballooning the pot).
   */
  escalation_scope?: "per_round" | "per_category" | "per_player_per_category";
  /** Group-specific labels for category="custom" items. Pure metadata
   *  used by the UI to render chip buttons — engine doesn't read it. */
  custom_categories?: Array<{ key: string; label: string }>;
};

/**
 * Default config used when a round opts into junk without picking
 * specifics. Matches the most-common casual-play recipe:
 *   $2 base, $2 escalation step, per-round scope, birdies + greenies
 *   + sandies + chip-ins active.
 */
export const DEFAULT_JUNK_CONFIG: JunkConfig = {
  active_categories: ["birdie", "greenie", "sandy", "chip_in"],
  mode: "escalating",
  base_amount_cents: 200,
  escalation_step_cents: 200,
  escalation_scope: "per_round"
};

// =============================================================
// Payout computation
// =============================================================

/**
 * Compute the payout for a new junk item given the prior items
 * already recorded. The application calls this at record time and
 * persists the returned amount with the item. NEVER call this at
 * settle time — it'd recompute amounts based on the current item set
 * and break the "the price was set when you hit the shot" invariant.
 *
 * Prior items are passed in chronological order (oldest first). The
 * function looks at length + category to derive the escalating amount.
 */
export function computeJunkAmount(
  config: JunkConfig,
  priorItems: JunkItem[],
  newCategory: JunkCategory,
  newPlayerId?: UUID
): number {
  if (config.mode === "flat") {
    return config.flat_amount_cents ?? 0;
  }
  const base = config.base_amount_cents ?? 0;
  const step = config.escalation_step_cents ?? 0;
  const scope = config.escalation_scope ?? "per_round";

  let priorCount = 0;
  switch (scope) {
    case "per_round":
      priorCount = priorItems.length;
      break;
    case "per_category":
      priorCount = priorItems.filter((i) => i.category === newCategory).length;
      break;
    case "per_player_per_category":
      priorCount = priorItems.filter(
        (i) => i.category === newCategory && i.player_id === newPlayerId
      ).length;
      break;
  }

  return base + priorCount * step;
}

// =============================================================
// Settlement
// =============================================================

export type JunkSettlement = {
  /** Per-player signed cents delta. Positive = won money. Always
   *  zero-sum across `players`. */
  deltaByPlayer: Map<UUID, number>;
  /** Itemized: how much each player won / lost from each junk. The
   *  finalize UI uses this for the "By game" breakdown line. */
  perItem: Array<{
    item: JunkItem;
    /** Each loser's payment to the winner (negative). */
    loser_deltas: Array<{ player_id: UUID; delta_cents: number }>;
    /** Total amount the winner gained on this item. */
    winner_gain_cents: number;
  }>;
  /** Total cash that moved through the junk pot — useful for "Junk
   *  moved $X" summary lines. Equals sum of winner_gain_cents. */
  total_moved_cents: number;
};

/**
 * Settle a set of junk items into per-player deltas. Pure function:
 * pass in the items + the players in the round, get back the money
 * each player owes or is owed.
 *
 * Standard rule (the only one we ship today): each item is paid by
 * every OTHER player in the round. With 4 players and a $2 item, the
 * winner gets +$6 and each non-winner pays -$2. Zero-sum.
 *
 * Players not present in the input are not paid by anyone — that's
 * what makes this safe to call mid-round with a subset of foursomes.
 */
export function settleJunk(
  items: JunkItem[],
  players: Array<{ id: UUID }>
): JunkSettlement {
  const deltaByPlayer = new Map<UUID, number>();
  for (const p of players) deltaByPlayer.set(p.id, 0);
  const playerIds = new Set(players.map((p) => p.id));
  const perItem: JunkSettlement["perItem"] = [];
  let total = 0;
  for (const item of items) {
    // Defensive: if the winner isn't in the player set (stale data,
    // foursome filter, etc.), skip the whole item. We don't quietly
    // debit the rest of the players to a winner that won't appear in
    // the output map — that breaks zero-sum from the consumer's POV.
    if (!playerIds.has(item.player_id)) {
      perItem.push({ item, loser_deltas: [], winner_gain_cents: 0 });
      continue;
    }
    const losers = players.filter((p) => p.id !== item.player_id);
    if (losers.length === 0 || item.amount_cents <= 0) {
      perItem.push({ item, loser_deltas: [], winner_gain_cents: 0 });
      continue;
    }
    const loser_deltas: Array<{ player_id: UUID; delta_cents: number }> = [];
    let winnerGain = 0;
    for (const loser of losers) {
      const d = -item.amount_cents;
      deltaByPlayer.set(loser.id, (deltaByPlayer.get(loser.id) ?? 0) + d);
      loser_deltas.push({ player_id: loser.id, delta_cents: d });
      winnerGain += item.amount_cents;
    }
    deltaByPlayer.set(
      item.player_id,
      (deltaByPlayer.get(item.player_id) ?? 0) + winnerGain
    );
    perItem.push({ item, loser_deltas, winner_gain_cents: winnerGain });
    total += winnerGain;
  }
  return { deltaByPlayer, perItem, total_moved_cents: total };
}

// =============================================================
// Live totals (UI helper)
// =============================================================

/**
 * Build per-player running totals for the live round-view "Junk"
 * panel. Same math as settleJunk, but indexed by category as well so
 * the UI can show "Pat: +$8 (3 birdies, 1 chip-in)".
 */
export type LiveJunkTotals = {
  byPlayer: Map<
    UUID,
    {
      net_cents: number;
      items_won: number;
      categoryCounts: Map<JunkCategory, number>;
    }
  >;
  total_items: number;
  total_pot_cents: number;
};

export function buildLiveJunkTotals(
  items: JunkItem[],
  players: Array<{ id: UUID }>
): LiveJunkTotals {
  const { deltaByPlayer, total_moved_cents } = settleJunk(items, players);
  const byPlayer = new Map<UUID, LiveJunkTotals["byPlayer"] extends Map<UUID, infer V> ? V : never>();
  for (const p of players) {
    byPlayer.set(p.id, {
      net_cents: deltaByPlayer.get(p.id) ?? 0,
      items_won: 0,
      categoryCounts: new Map()
    });
  }
  for (const it of items) {
    const slot = byPlayer.get(it.player_id);
    if (!slot) continue;
    slot.items_won += 1;
    slot.categoryCounts.set(
      it.category,
      (slot.categoryCounts.get(it.category) ?? 0) + 1
    );
  }
  return {
    byPlayer,
    total_items: items.length,
    total_pot_cents: total_moved_cents
  };
}

// =============================================================
// Display helpers
// =============================================================

const CATEGORY_LABELS: Record<JunkCategory, string> = {
  birdie: "Birdie",
  eagle: "Eagle",
  greenie: "Greenie",
  poley: "Poley",
  pinnie: "Pinnie",
  sandy: "Sandy",
  barkie: "Barkie",
  chip_in: "Chip-in",
  net_birdie: "Net birdie",
  custom: "Other"
};

/**
 * Display label for a junk item. Uses the built-in category label
 * unless the item has a custom_label (typical for category=custom).
 */
export function junkLabel(item: JunkItem): string {
  if (item.custom_label && item.custom_label.trim().length > 0) {
    return item.custom_label;
  }
  return CATEGORY_LABELS[item.category] ?? item.category;
}

/**
 * Resolve the canonical label for a category — used by the chip
 * picker UI when building the entry surface.
 */
export function categoryLabel(c: JunkCategory): string {
  return CATEGORY_LABELS[c] ?? c;
}
