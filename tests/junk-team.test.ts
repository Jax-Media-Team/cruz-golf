/**
 * Team junk regression suite.
 *
 * Patrick 2026-05-13 #4: "In real games, junk is often won by a team,
 * not just one player... In 6-6-6, if my partner and I win 3 junk
 * items at $2 each, that should show as team junk and affect both
 * partners appropriately."
 *
 * Settlement rules for team junk (per the agent-5 design proposal):
 *   - Each loser pays `amount_cents` ONCE (the displayed amount stays
 *     the displayed amount regardless of partner count).
 *   - The pot (amount × loser count) is split evenly among recipients.
 *   - Odd-cent remainder goes to the lowest-id recipient by sort (so
 *     re-runs produce the same settlement).
 *
 * Backwards compat: a JunkItem WITHOUT `recipient_ids` settles
 * identically to today — same +winnerGain to player_id, same losses
 * to everyone else.
 */

import { describe, expect, it } from "vitest";
import { settleJunk, buildLiveJunkTotals, type JunkItem } from "../lib/games/junk";

const players = [
  { id: "pat" },
  { id: "ben" },
  { id: "mitch" },
  { id: "kyle" }
];

function makeItem(over: Partial<JunkItem>): JunkItem {
  return {
    id: "i-" + Math.random().toString(36).slice(2, 7),
    player_id: "pat",
    hole_number: 1,
    category: "birdie",
    amount_cents: 200,
    created_at: new Date().toISOString(),
    ...over
  };
}

describe("settleJunk — team junk basics", () => {
  it("Patrick's example: 4-player round, $2 team junk (Pat+Ben vs Mitch+Kyle)", () => {
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben"],
      amount_cents: 200,
      is_team_award: true
    });
    const r = settleJunk([item], players);
    expect(r.deltaByPlayer.get("pat")).toBe(200);
    expect(r.deltaByPlayer.get("ben")).toBe(200);
    expect(r.deltaByPlayer.get("mitch")).toBe(-200);
    expect(r.deltaByPlayer.get("kyle")).toBe(-200);
    // Zero-sum invariant.
    const sum = [...r.deltaByPlayer.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    // Pot accounting.
    expect(r.total_moved_cents).toBe(400);
    expect(r.perItem[0].winner_gain_cents).toBe(400);
    expect(r.perItem[0].recipient_deltas).toHaveLength(2);
    expect(r.perItem[0].loser_deltas).toHaveLength(2);
  });

  it("Patrick's exact scenario: 3 team junk @ $2 in 6-6-6", () => {
    const items: JunkItem[] = [
      makeItem({
        id: "i1",
        player_id: "pat",
        recipient_ids: ["pat", "ben"],
        amount_cents: 200,
        is_team_award: true
      }),
      makeItem({
        id: "i2",
        player_id: "ben",
        recipient_ids: ["pat", "ben"],
        amount_cents: 200,
        is_team_award: true
      }),
      makeItem({
        id: "i3",
        player_id: "pat",
        recipient_ids: ["pat", "ben"],
        amount_cents: 200,
        is_team_award: true
      })
    ];
    const r = settleJunk(items, players);
    expect(r.deltaByPlayer.get("pat")).toBe(600);
    expect(r.deltaByPlayer.get("ben")).toBe(600);
    expect(r.deltaByPlayer.get("mitch")).toBe(-600);
    expect(r.deltaByPlayer.get("kyle")).toBe(-600);
    expect(r.total_moved_cents).toBe(1200);
  });

  it("Mixed: 1 team junk + 1 solo junk, zero-sum holds across both", () => {
    const items: JunkItem[] = [
      makeItem({
        id: "i1",
        player_id: "pat",
        recipient_ids: ["pat", "ben"],
        amount_cents: 200,
        is_team_award: true
      }),
      makeItem({
        id: "i2",
        player_id: "mitch",
        amount_cents: 100
        // no recipient_ids → legacy solo path
      })
    ];
    const r = settleJunk(items, players);
    // Item 1 (team): Pat+200, Ben+200, Mitch-200, Kyle-200
    // Item 2 (solo): Mitch +300 ($1 from each of 3 others), Pat-100, Ben-100, Kyle-100
    expect(r.deltaByPlayer.get("pat")).toBe(200 - 100);
    expect(r.deltaByPlayer.get("ben")).toBe(200 - 100);
    expect(r.deltaByPlayer.get("mitch")).toBe(-200 + 300);
    expect(r.deltaByPlayer.get("kyle")).toBe(-200 - 100);
    const sum = [...r.deltaByPlayer.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });
});

describe("settleJunk — odd-cent splits", () => {
  it("$1 team junk with 2 recipients vs 2 opponents: $2 pot / 2 = $1 each (clean)", () => {
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben"],
      amount_cents: 100,
      is_team_award: true
    });
    const r = settleJunk([item], players);
    expect(r.deltaByPlayer.get("pat")).toBe(100);
    expect(r.deltaByPlayer.get("ben")).toBe(100);
    expect(r.deltaByPlayer.get("mitch")).toBe(-100);
    expect(r.deltaByPlayer.get("kyle")).toBe(-100);
  });

  it("$1 team junk with 2 recipients vs 1 opponent (3-player round): pot=$1, share=$0 + $1 remainder", () => {
    const three = [{ id: "pat" }, { id: "ben" }, { id: "mitch" }];
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben"],
      amount_cents: 100,
      is_team_award: true
    });
    const r = settleJunk([item], three);
    // Pot = 100 cents (Mitch's loss). Two recipients: share=floor(100/2)=50,
    // remainder=0. Both partners get 50.
    expect(r.deltaByPlayer.get("pat")).toBe(50);
    expect(r.deltaByPlayer.get("ben")).toBe(50);
    expect(r.deltaByPlayer.get("mitch")).toBe(-100);
    const sum = [...r.deltaByPlayer.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it("Odd-cent: $3 team junk with 2 recipients vs 1 opponent: pot=$3, share=$1 + $1 remainder", () => {
    const three = [{ id: "pat" }, { id: "ben" }, { id: "mitch" }];
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben"],
      amount_cents: 300,
      is_team_award: true
    });
    const r = settleJunk([item], three);
    // Pot = 300. Recipients sorted: ["ben", "pat"]. Share = floor(300/2) = 150.
    // Remainder = 300 - 300 = 0 (clean).
    expect(r.deltaByPlayer.get("pat")).toBe(150);
    expect(r.deltaByPlayer.get("ben")).toBe(150);
    expect(r.deltaByPlayer.get("mitch")).toBe(-300);
  });

  it("Odd-cent: $1 team junk with 3 recipients vs 1 opponent: pot=$1, share=$0 + $1 remainder", () => {
    // 4-player round, 3-person team (rare but possible in scramble).
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben", "mitch"],
      amount_cents: 100,
      is_team_award: true
    });
    const r = settleJunk([item], players);
    // Pot = 100. Recipients sorted alpha: ["ben", "mitch", "pat"].
    // share = floor(100/3) = 33. remainder = 100 - 99 = 1.
    // Ben (lowest sort) gets 33 + 1 = 34; mitch + pat each get 33.
    expect(r.deltaByPlayer.get("ben")).toBe(34);
    expect(r.deltaByPlayer.get("mitch")).toBe(33);
    expect(r.deltaByPlayer.get("pat")).toBe(33);
    expect(r.deltaByPlayer.get("kyle")).toBe(-100);
    const sum = [...r.deltaByPlayer.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });
});

describe("settleJunk — stranger / edge cases", () => {
  it("Team junk where one recipient isn't in players: filters that recipient, remaining settle", () => {
    const item = makeItem({
      player_id: "pat",
      recipient_ids: ["pat", "ben", "STRANGER"],
      amount_cents: 200,
      is_team_award: true
    });
    const r = settleJunk([item], players);
    // STRANGER filtered out. Pat + Ben split as a 2-person team.
    expect(r.deltaByPlayer.get("pat")).toBe(200);
    expect(r.deltaByPlayer.get("ben")).toBe(200);
    expect(r.deltaByPlayer.get("mitch")).toBe(-200);
    expect(r.deltaByPlayer.get("kyle")).toBe(-200);
  });

  it("Team junk where NO recipient is in players: skips whole item, no deltas", () => {
    const item = makeItem({
      player_id: "GHOST",
      recipient_ids: ["GHOST", "STRANGER"],
      amount_cents: 200,
      is_team_award: true
    });
    const r = settleJunk([item], players);
    for (const p of players) {
      expect(r.deltaByPlayer.get(p.id)).toBe(0);
    }
    expect(r.total_moved_cents).toBe(0);
  });

  it("Backwards compat: item with NO recipient_ids settles as solo (Patrick gets full pot)", () => {
    const item = makeItem({
      player_id: "pat",
      amount_cents: 200
      // recipient_ids undefined
    });
    const r = settleJunk([item], players);
    expect(r.deltaByPlayer.get("pat")).toBe(600); // +$2 from each of 3 others
    expect(r.deltaByPlayer.get("ben")).toBe(-200);
    expect(r.deltaByPlayer.get("mitch")).toBe(-200);
    expect(r.deltaByPlayer.get("kyle")).toBe(-200);
  });

  it("Backwards compat: item with EMPTY recipient_ids settles as solo too", () => {
    const item = makeItem({
      player_id: "pat",
      recipient_ids: [],
      amount_cents: 200
    });
    const r = settleJunk([item], players);
    expect(r.deltaByPlayer.get("pat")).toBe(600);
  });
});

describe("buildLiveJunkTotals — team junk", () => {
  it("Each partner's net reflects their share, not double-count", () => {
    const items: JunkItem[] = [
      makeItem({
        id: "i1",
        player_id: "pat",
        recipient_ids: ["pat", "ben"],
        amount_cents: 200,
        is_team_award: true
      })
    ];
    const totals = buildLiveJunkTotals(items, players);
    // Pat and Ben each up $2; Mitch + Kyle each down $2.
    expect(totals.byPlayer.get("pat")!.net_cents).toBe(200);
    expect(totals.byPlayer.get("ben")!.net_cents).toBe(200);
    expect(totals.byPlayer.get("mitch")!.net_cents).toBe(-200);
    expect(totals.byPlayer.get("kyle")!.net_cents).toBe(-200);
    // items_won counts the PRIMARY recipient (player_id), not every
    // partner — keeps "Pat got 3 birdies" attribution intact even when
    // the items were team awards.
    expect(totals.byPlayer.get("pat")!.items_won).toBe(1);
    expect(totals.byPlayer.get("ben")!.items_won).toBe(0);
  });
});
