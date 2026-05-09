import { describe, expect, it } from "vitest";
import { settleGame } from "@/lib/games";
import { makeGame, makeHoles, makeInput, makePlayer, makeScores } from "./fixtures";

/**
 * Pot-based skins: every player buys in for buyin_cents. The total pot is
 * divided equally among all skins won. Zero-sum guaranteed.
 */

const A = "p-a", B = "p-b", C = "p-c", D = "p-d";
const COURSE = { holes: makeHoles(), par: 72 };

function fourPlayers() {
  return [
    makePlayer({ id: A, name: "Alice", playing_handicap: 0 }),
    makePlayer({ id: B, name: "Bob", playing_handicap: 0 }),
    makePlayer({ id: C, name: "Carl", playing_handicap: 0 }),
    makePlayer({ id: D, name: "Dee", playing_handicap: 0 })
  ];
}

function sumDeltas(out: ReturnType<typeof settleGame>): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

describe("pot-based skins", () => {
  it("4 players × $20 buy-in, 4 skins won → $20/skin, zero-sum", () => {
    const ps = fourPlayers();
    // Alice wins H1, H3 (birdie); Bob wins H2; Carl wins H4. 4 skins total.
    // Alice: 3,4,3,5...(par on rest) - wins H1 + H3
    // Bob:   4,3,4,5...                    - wins H2
    // Carl:  5,5,5,3...                    - wins H4 (only one with 3)
    // Dee:   6,6,6,6...
    const round = (n: number) => new Array(18).fill(n);
    const scores = makeScores({
      [A]: [3, 4, 3, 5, ...round(14).map(() => 4)],
      [B]: [4, 3, 4, 5, ...round(14).map(() => 4)],
      [C]: [5, 5, 5, 3, ...round(14).map(() => 4)],
      [D]: [6, 6, 6, 6, ...round(14).map(() => 4)]
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 2000,
      config: { skin_mode: "pot", buyin_cents: 2000 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("final");
    // 14 holes 4-4-4-4 ties → carry. Pot = $80. 4 skins won → $20/skin.
    // Alice won 2 skins → +$40 - $20 buyin = +$20
    // Bob won 1 skin → +$20 - $20 buyin = 0
    // Carl won 1 skin → +$20 - $20 buyin = 0
    // Dee won 0 → -$20
    expect(out.perPlayer.get(A)?.delta_cents).toBe(2000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(0);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(0);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-2000);
  });

  it("zero skins won → zero money moves (pot is refunded)", () => {
    const ps = fourPlayers();
    // Everyone shoots par on every hole — every hole ties.
    const par4 = new Array(18).fill(4);
    const scores = makeScores({ [A]: par4, [B]: par4, [C]: par4, [D]: par4 });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 2000,
      config: { skin_mode: "pot", buyin_cents: 2000 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    for (const v of out.perPlayer.values()) {
      expect(v.delta_cents).toBe(0);
    }
  });

  it("single skin → winner gets entire pot minus their own buyin", () => {
    const ps = fourPlayers();
    // Only Alice scores under par on H1; everyone else ties for the rest.
    const par4 = new Array(18).fill(4);
    const scores = makeScores({
      [A]: [3, ...par4.slice(1)],
      [B]: par4,
      [C]: par4,
      [D]: par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 2000,
      config: { skin_mode: "pot", buyin_cents: 2000 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    // Pot = $80. 1 skin → $80 to winner. Alice: +$80 - $20 = +$60.
    expect(out.perPlayer.get(A)?.delta_cents).toBe(6000);
    expect(out.perPlayer.get(B)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(C)?.delta_cents).toBe(-2000);
    expect(out.perPlayer.get(D)?.delta_cents).toBe(-2000);
  });

  it("8-player pot example from spec — $20 × 8 = $160, 4 skins → $40/skin", () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      makePlayer({ id: `p-${i}`, name: `Player ${i}`, playing_handicap: 0 })
    );
    // Player 0 wins H1; player 1 wins H2; player 2 wins H3; player 3 wins H4.
    // Holes 5-18 all tie (carry).
    const par4 = new Array(18).fill(4);
    const winning = (idx: number) => par4.map((p, i) => (i === idx ? 3 : p));
    const scores = makeScores({
      "p-0": winning(0),
      "p-1": winning(1),
      "p-2": winning(2),
      "p-3": winning(3),
      "p-4": par4,
      "p-5": par4,
      "p-6": par4,
      "p-7": par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 2000,
      config: { skin_mode: "pot", buyin_cents: 2000 }
    });
    const out = settleGame(makeInput({ game, players: eight, scores, course: COURSE }));
    expect(sumDeltas(out)).toBe(0);
    // Each winner: +$40 (one skin) - $20 buyin = +$20
    // Each non-winner: -$20
    for (let i = 0; i < 4; i++) {
      expect(out.perPlayer.get(`p-${i}`)?.delta_cents).toBe(2000);
    }
    for (let i = 4; i < 8; i++) {
      expect(out.perPlayer.get(`p-${i}`)?.delta_cents).toBe(-2000);
    }
  });

  it("uneven pot (rounding remainder) is deterministic and zero-sum", () => {
    // 3 players × $7 = $21 pot. 2 skins → $10.50 each → $10 each + 1 cent rem.
    const ps = [A, B, C].map((id) => makePlayer({ id, name: id, playing_handicap: 0 }));
    const par4 = new Array(18).fill(4);
    const scores = makeScores({
      [A]: [3, ...par4.slice(1)],
      [B]: [4, 3, ...par4.slice(2)],
      [C]: par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 700,
      config: { skin_mode: "pot", buyin_cents: 700 }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    // sum must be exactly zero despite rounding
    expect(sumDeltas(out)).toBe(0);
  });

  it("pot mode + 'split' tie rule falls back to 'carry'", () => {
    const ps = fourPlayers();
    // Two players tie for low on H1 — under "split" in fixed mode they'd
    // share the value; under pot it should treat as carry (no skin awarded).
    const par4 = new Array(18).fill(4);
    const scores = makeScores({
      [A]: [3, ...par4.slice(1)], // tied at 3 on H1
      [B]: [3, ...par4.slice(1)], // tied at 3 on H1
      [C]: par4,
      [D]: par4
    });
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 2000,
      config: { skin_mode: "pot", buyin_cents: 2000, ties: "split" }
    });
    const out = settleGame(makeInput({ game, players: ps, scores, course: COURSE }));
    // No skins awarded (every hole tied or A/B tied). Pot returns. Zero-sum.
    expect(sumDeltas(out)).toBe(0);
    for (const v of out.perPlayer.values()) {
      expect(v.delta_cents).toBe(0);
    }
  });
});
