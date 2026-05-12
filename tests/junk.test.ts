/**
 * Tests for the junk side-bet engine.
 *
 * Patrick's QA list from the real-world tester ask:
 *   - flat junk
 *   - escalating junk
 *   - multiple junk items on one hole
 *   - multiple players winning junk on same hole
 *   - junk settlement zero-sum / payout integrity
 *   - interaction with skins/Nassau/6-6-6/best ball
 *   - editing/removing a junk item
 *   - final settlement including junk
 *
 * The engine is a pure function over JunkItem[] + players. Interaction
 * with other games is by ADDITION at finalize time — the junk delta
 * gets summed with each game's per-player delta. So "interaction" tests
 * are really "zero-sum on its own + additive composes cleanly".
 */
import { describe, expect, it } from "vitest";
import {
  buildLiveJunkTotals,
  categoryLabel,
  computeJunkAmount,
  DEFAULT_JUNK_CONFIG,
  junkLabel,
  settleJunk,
  type JunkConfig,
  type JunkItem
} from "@/lib/games/junk";

const PLAYERS = [
  { id: "rp-pat" },
  { id: "rp-ben" },
  { id: "rp-mit" },
  { id: "rp-kyl" }
];

function item(overrides: Partial<JunkItem> & Pick<JunkItem, "player_id" | "hole_number" | "category" | "amount_cents">): JunkItem {
  return {
    id: overrides.id ?? `i-${Math.random().toString(36).slice(2, 8)}`,
    created_at: overrides.created_at ?? new Date().toISOString(),
    ...overrides
  };
}

// =============================================================
// computeJunkAmount — flat
// =============================================================

describe("computeJunkAmount — flat mode", () => {
  const cfg: JunkConfig = {
    active_categories: ["birdie", "greenie"],
    mode: "flat",
    flat_amount_cents: 200
  };

  it("always returns the flat amount regardless of priors", () => {
    expect(computeJunkAmount(cfg, [], "birdie")).toBe(200);
    expect(
      computeJunkAmount(
        cfg,
        [
          item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 }),
          item({ player_id: "rp-ben", hole_number: 2, category: "greenie", amount_cents: 200 })
        ],
        "birdie"
      )
    ).toBe(200);
  });

  it("returns 0 when flat_amount_cents is missing (defensive)", () => {
    expect(computeJunkAmount({ ...cfg, flat_amount_cents: undefined }, [], "birdie")).toBe(0);
  });
});

// =============================================================
// computeJunkAmount — escalating
// =============================================================

describe("computeJunkAmount — escalating mode", () => {
  const cfg: JunkConfig = {
    active_categories: ["birdie", "greenie"],
    mode: "escalating",
    base_amount_cents: 200,
    escalation_step_cents: 200,
    escalation_scope: "per_round"
  };

  it("first item pays base", () => {
    expect(computeJunkAmount(cfg, [], "birdie")).toBe(200);
  });

  it("per_round scope: $2 → $4 → $6 across mixed categories", () => {
    const a = item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 });
    const b = item({ player_id: "rp-ben", hole_number: 2, category: "greenie", amount_cents: 400 });
    expect(computeJunkAmount(cfg, [a], "greenie")).toBe(400);
    expect(computeJunkAmount(cfg, [a, b], "birdie")).toBe(600);
  });

  it("per_category scope: birdies and greenies escalate independently", () => {
    const c = { ...cfg, escalation_scope: "per_category" as const };
    const a = item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 });
    const b = item({ player_id: "rp-ben", hole_number: 2, category: "greenie", amount_cents: 200 });
    // Second birdie sees 1 prior birdie → 400.
    expect(computeJunkAmount(c, [a, b], "birdie")).toBe(400);
    // Second greenie sees 1 prior greenie → 400.
    expect(computeJunkAmount(c, [a, b], "greenie")).toBe(400);
    // Third (first ever sandy) sees 0 prior sandies → 200.
    expect(computeJunkAmount(c, [a, b], "sandy")).toBe(200);
  });

  it("per_player_per_category scope: only same player's same-category items count", () => {
    const c = { ...cfg, escalation_scope: "per_player_per_category" as const };
    const a = item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 });
    const b = item({ player_id: "rp-pat", hole_number: 4, category: "birdie", amount_cents: 400 });
    // Pat's third birdie sees 2 prior → 600.
    expect(computeJunkAmount(c, [a, b], "birdie", "rp-pat")).toBe(600);
    // Ben's first birdie sees 0 prior → 200.
    expect(computeJunkAmount(c, [a, b], "birdie", "rp-ben")).toBe(200);
  });

  it("returns base when step is missing", () => {
    expect(computeJunkAmount({ ...cfg, escalation_step_cents: undefined }, [], "birdie")).toBe(200);
  });

  it("returns 0 when both base and step are missing", () => {
    expect(
      computeJunkAmount(
        {
          active_categories: ["birdie"],
          mode: "escalating",
          base_amount_cents: undefined,
          escalation_step_cents: undefined
        },
        [],
        "birdie"
      )
    ).toBe(0);
  });
});

// =============================================================
// settleJunk — payout integrity
// =============================================================

describe("settleJunk — payout integrity", () => {
  it("single $2 birdie: winner +$6 in a 4-player round, each other player -$2", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 })
    ];
    const out = settleJunk(items, PLAYERS);
    expect(out.deltaByPlayer.get("rp-pat")).toBe(600);
    expect(out.deltaByPlayer.get("rp-ben")).toBe(-200);
    expect(out.deltaByPlayer.get("rp-mit")).toBe(-200);
    expect(out.deltaByPlayer.get("rp-kyl")).toBe(-200);
    expect(out.total_moved_cents).toBe(600);
  });

  it("zero-sum across all junk items", () => {
    // Use realistic escalating amounts: 200, 400, 600, 800, 1000
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 }),
      item({ player_id: "rp-ben", hole_number: 3, category: "greenie", amount_cents: 400 }),
      item({ player_id: "rp-pat", hole_number: 4, category: "birdie", amount_cents: 600 }),
      item({ player_id: "rp-mit", hole_number: 7, category: "chip_in", amount_cents: 800 }),
      item({ player_id: "rp-kyl", hole_number: 11, category: "sandy", amount_cents: 1000 })
    ];
    const out = settleJunk(items, PLAYERS);
    let sum = 0;
    for (const v of out.deltaByPlayer.values()) sum += v;
    expect(sum).toBe(0);
  });

  it("multiple junk items on one hole settle independently — Pat birdies + Ben chips in on hole 5", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 5, category: "birdie", amount_cents: 200 }),
      item({ player_id: "rp-ben", hole_number: 5, category: "chip_in", amount_cents: 400 })
    ];
    const out = settleJunk(items, PLAYERS);
    // Pat: +600 from birdie, -400 from chip-in (he owes Ben) = +200
    expect(out.deltaByPlayer.get("rp-pat")).toBe(600 - 400);
    // Ben: -200 from birdie, +1200 from chip-in = +1000
    expect(out.deltaByPlayer.get("rp-ben")).toBe(-200 + 1200);
    // Mit + Kyl pay $2 + $4 = $6 each.
    expect(out.deltaByPlayer.get("rp-mit")).toBe(-600);
    expect(out.deltaByPlayer.get("rp-kyl")).toBe(-600);
    let sum = 0;
    for (const v of out.deltaByPlayer.values()) sum += v;
    expect(sum).toBe(0);
  });

  it("two players each get a birdie on different holes: settles as two distinct $X transfers", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 2, category: "birdie", amount_cents: 200 }),
      item({ player_id: "rp-ben", hole_number: 8, category: "birdie", amount_cents: 400 })
    ];
    const out = settleJunk(items, PLAYERS);
    // Pat: +600 from his birdie - 400 paid to Ben = +200
    expect(out.deltaByPlayer.get("rp-pat")).toBe(600 - 400);
    // Ben: -200 paid to Pat + 1200 won = +1000
    expect(out.deltaByPlayer.get("rp-ben")).toBe(-200 + 1200);
    // Mit + Kyl: -200 + -400 = -600
    expect(out.deltaByPlayer.get("rp-mit")).toBe(-600);
    expect(out.deltaByPlayer.get("rp-kyl")).toBe(-600);
  });

  it("perItem array captures per-loser deltas for audit / display", () => {
    const items: JunkItem[] = [
      item({ id: "junk-1", player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 })
    ];
    const out = settleJunk(items, PLAYERS);
    expect(out.perItem).toHaveLength(1);
    expect(out.perItem[0].item.id).toBe("junk-1");
    expect(out.perItem[0].winner_gain_cents).toBe(600);
    expect(out.perItem[0].loser_deltas).toHaveLength(3);
    expect(out.perItem[0].loser_deltas.every((d) => d.delta_cents === -200)).toBe(true);
  });

  it("3-player round: winner takes from 2 others", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 })
    ];
    const players3 = [{ id: "rp-pat" }, { id: "rp-ben" }, { id: "rp-mit" }];
    const out = settleJunk(items, players3);
    expect(out.deltaByPlayer.get("rp-pat")).toBe(400);
    expect(out.deltaByPlayer.get("rp-ben")).toBe(-200);
    expect(out.deltaByPlayer.get("rp-mit")).toBe(-200);
  });

  it("solo round (1 player): no payout, no error", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 })
    ];
    const out = settleJunk(items, [{ id: "rp-pat" }]);
    expect(out.deltaByPlayer.get("rp-pat")).toBe(0);
    expect(out.total_moved_cents).toBe(0);
  });

  it("skips items where the winner isn't in the players list — preserves zero-sum for the foursome", () => {
    // A junk item recorded against a player not in the current
    // settlement scope (stale data, filter mismatch, cross-foursome
    // surface). The engine defensively no-ops the item rather than
    // silently debiting the rest of the players to a winner they
    // can't see. Output is still zero-sum across the input players.
    const items: JunkItem[] = [
      item({ player_id: "rp-stranger", hole_number: 1, category: "birdie", amount_cents: 200 }),
      // A second, valid item to confirm the engine doesn't bail on
      // the whole settle.
      item({ player_id: "rp-pat", hole_number: 2, category: "greenie", amount_cents: 400 })
    ];
    const out = settleJunk(items, PLAYERS);
    // Stranger item ignored → only Pat's $4 greenie applies.
    expect(out.deltaByPlayer.get("rp-pat")).toBe(1200);
    expect(out.deltaByPlayer.get("rp-ben")).toBe(-400);
    expect(out.deltaByPlayer.get("rp-mit")).toBe(-400);
    expect(out.deltaByPlayer.get("rp-kyl")).toBe(-400);
    let sum = 0;
    for (const v of out.deltaByPlayer.values()) sum += v;
    expect(sum).toBe(0);
    // perItem array still records BOTH items (so audit + display can
    // surface "this item didn't settle"), but the stranger's gain is 0.
    expect(out.perItem).toHaveLength(2);
    expect(out.perItem[0].winner_gain_cents).toBe(0);
    expect(out.perItem[1].winner_gain_cents).toBe(1200);
  });

  it("zero-amount item is a no-op", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 0 })
    ];
    const out = settleJunk(items, PLAYERS);
    for (const v of out.deltaByPlayer.values()) expect(v).toBe(0);
    expect(out.total_moved_cents).toBe(0);
  });
});

// =============================================================
// editing/removing items — engine is pure, item set is the truth
// =============================================================

describe("settleJunk — editing/removing items", () => {
  it("removing an item from the input set zeros out that item's contribution", () => {
    const a = item({ id: "a", player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 });
    const b = item({ id: "b", player_id: "rp-ben", hole_number: 3, category: "greenie", amount_cents: 400 });
    const withBoth = settleJunk([a, b], PLAYERS);
    const withOnlyA = settleJunk([a], PLAYERS);
    // Pat: 600 - 400 = 200 with both; 600 with only a. Removing b
    // should refund Pat $4.
    expect(withBoth.deltaByPlayer.get("rp-pat")).toBe(200);
    expect(withOnlyA.deltaByPlayer.get("rp-pat")).toBe(600);
  });

  it("editing an item's amount changes the settlement — no stale cache", () => {
    const cheap = item({ id: "x", player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 });
    const pricey = { ...cheap, amount_cents: 1000 };
    const out1 = settleJunk([cheap], PLAYERS);
    const out2 = settleJunk([pricey], PLAYERS);
    expect(out1.deltaByPlayer.get("rp-pat")).toBe(600);
    expect(out2.deltaByPlayer.get("rp-pat")).toBe(3000);
  });
});

// =============================================================
// Interaction with other games — additive composition
// =============================================================

describe("interaction with other games (additive composition)", () => {
  it("junk delta adds cleanly on top of a Nassau / 6-6-6 / Best Ball settlement", () => {
    // Pretend a 6-6-6 game ended with Pat:+1000, Ben:-1000, Mit:0, Kyl:0
    // (1 segment win, others tied). Then 1 birdie by Mit ($2 escalating
    // base). The combined settlement should be:
    //   Pat: +1000 - 200 = +800
    //   Ben: -1000 - 200 = -1200
    //   Mit: 0 + 600 = +600
    //   Kyl: 0 - 200 = -200
    // Sum 0.
    const gameDeltas = new Map<string, number>([
      ["rp-pat", 1000],
      ["rp-ben", -1000],
      ["rp-mit", 0],
      ["rp-kyl", 0]
    ]);
    const junk = settleJunk(
      [item({ player_id: "rp-mit", hole_number: 7, category: "birdie", amount_cents: 200 })],
      PLAYERS
    );
    const combined = new Map<string, number>();
    for (const [k, v] of gameDeltas) combined.set(k, v);
    for (const [k, v] of junk.deltaByPlayer) {
      combined.set(k, (combined.get(k) ?? 0) + v);
    }
    expect(combined.get("rp-pat")).toBe(800);
    expect(combined.get("rp-ben")).toBe(-1200);
    expect(combined.get("rp-mit")).toBe(600);
    expect(combined.get("rp-kyl")).toBe(-200);
    let sum = 0;
    for (const v of combined.values()) sum += v;
    expect(sum).toBe(0);
  });

  it("zero-sum invariant survives any number of games + junk items combined", () => {
    // Three games (made up) + 4 junk items. Every per-game delta is
    // zero-sum and so is junk. The COMBINED total must be zero too.
    const game1: Array<[string, number]> = [
      ["rp-pat", 500],
      ["rp-ben", -300],
      ["rp-mit", -100],
      ["rp-kyl", -100]
    ];
    const game2: Array<[string, number]> = [
      ["rp-pat", -200],
      ["rp-ben", 600],
      ["rp-mit", -200],
      ["rp-kyl", -200]
    ];
    const game3: Array<[string, number]> = [
      ["rp-pat", 0],
      ["rp-ben", 0],
      ["rp-mit", 500],
      ["rp-kyl", -500]
    ];
    const junkItems: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 }),
      item({ player_id: "rp-ben", hole_number: 4, category: "greenie", amount_cents: 400 }),
      item({ player_id: "rp-mit", hole_number: 9, category: "sandy", amount_cents: 600 }),
      item({ player_id: "rp-kyl", hole_number: 13, category: "chip_in", amount_cents: 800 })
    ];
    const junk = settleJunk(junkItems, PLAYERS);

    const combined = new Map<string, number>([
      ["rp-pat", 0],
      ["rp-ben", 0],
      ["rp-mit", 0],
      ["rp-kyl", 0]
    ]);
    for (const [k, v] of [...game1, ...game2, ...game3]) {
      combined.set(k, combined.get(k)! + v);
    }
    for (const [k, v] of junk.deltaByPlayer) {
      combined.set(k, combined.get(k)! + v);
    }
    let sum = 0;
    for (const v of combined.values()) sum += v;
    expect(sum).toBe(0);
  });
});

// =============================================================
// Live totals (UI helper)
// =============================================================

describe("buildLiveJunkTotals", () => {
  it("counts items per player per category + tracks net cents", () => {
    const items: JunkItem[] = [
      item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 }),
      item({ player_id: "rp-pat", hole_number: 4, category: "birdie", amount_cents: 400 }),
      item({ player_id: "rp-pat", hole_number: 9, category: "chip_in", amount_cents: 600 }),
      item({ player_id: "rp-ben", hole_number: 11, category: "sandy", amount_cents: 800 })
    ];
    const live = buildLiveJunkTotals(items, PLAYERS);
    const pat = live.byPlayer.get("rp-pat")!;
    expect(pat.items_won).toBe(3);
    expect(pat.categoryCounts.get("birdie")).toBe(2);
    expect(pat.categoryCounts.get("chip_in")).toBe(1);
    // Pat's net: +600+1200+1800 (won) - 800 (paid to Ben's sandy) = 2800
    expect(pat.net_cents).toBe(600 + 1200 + 1800 - 800);
    expect(live.total_items).toBe(4);
    expect(live.total_pot_cents).toBe(600 + 1200 + 1800 + 2400);
  });
});

// =============================================================
// Display helpers
// =============================================================

describe("display helpers", () => {
  it("junkLabel uses the built-in category label by default", () => {
    expect(
      junkLabel(item({ player_id: "rp-pat", hole_number: 1, category: "birdie", amount_cents: 200 }))
    ).toBe("Birdie");
  });

  it("junkLabel uses custom_label when present", () => {
    expect(
      junkLabel(
        item({
          player_id: "rp-pat",
          hole_number: 1,
          category: "custom",
          custom_label: "Woodie",
          amount_cents: 200
        })
      )
    ).toBe("Woodie");
  });

  it("categoryLabel resolves canonical labels", () => {
    expect(categoryLabel("birdie")).toBe("Birdie");
    expect(categoryLabel("chip_in")).toBe("Chip-in");
    expect(categoryLabel("net_birdie")).toBe("Net birdie");
  });
});

// =============================================================
// Default config sanity
// =============================================================

describe("DEFAULT_JUNK_CONFIG", () => {
  it("matches Patrick's '$2 escalating, per-round' default", () => {
    expect(DEFAULT_JUNK_CONFIG.mode).toBe("escalating");
    expect(DEFAULT_JUNK_CONFIG.base_amount_cents).toBe(200);
    expect(DEFAULT_JUNK_CONFIG.escalation_step_cents).toBe(200);
    expect(DEFAULT_JUNK_CONFIG.escalation_scope).toBe("per_round");
  });
  it("ships with the 7 categories Patrick listed, in display order", () => {
    expect(DEFAULT_JUNK_CONFIG.active_categories).toEqual([
      "birdie",
      "eagle",
      "greenie",
      "sandy",
      "chip_in",
      "poley",
      "pinny"
    ]);
  });
  it("barkie + net_birdie stay in the type but are not active by default", () => {
    expect(DEFAULT_JUNK_CONFIG.active_categories).not.toContain("barkie");
    expect(DEFAULT_JUNK_CONFIG.active_categories).not.toContain("net_birdie");
  });
});
