import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput, holesInPlay } from "./helpers";

type SkinsConfig = {
  net?: boolean;
  /**
   * Pricing mode:
   *   "pot"        — every player buys in for buyin_cents. Pot = buyin × N.
   *                  At end of round, pot is divided EQUALLY among the skins
   *                  won. 4 skins won on an $80 pot = $20 per skin. (Default.)
   *   "fixed"      — fixed skin_value_cents per skin awarded. Each skin moves
   *                  that much money from non-winners to winners.
   */
  skin_mode?: "pot" | "fixed";
  /** Per-player buy-in (used only in pot mode). */
  buyin_cents?: number;
  /** Fixed value per skin (used only in fixed mode). */
  skin_value_cents?: number;
  ties?: "carry" | "split" | "nullify";
  unclaimed?: "split_all_players" | "split_winners" | "refund";
  // Canadian-style options:
  require_birdie?: boolean;
  /** Carry escalation, fixed mode only. */
  escalation?: "flat" | "linear" | "double";
};

/**
 * Generic skins engine. Used by skins_gross, skins_net, skins_canadian.
 *
 * Two pricing modes:
 *   - "pot"   (default): every player buys in; pot is divided equally among
 *             all skins won. 4 skins on a $160 pot = $40/skin. If zero skins
 *             are won, pot returns (no money moves).
 *   - "fixed": fixed dollar value per skin. Optional carry escalation.
 */
export function settleSkins(input: GameInput, mode: "gross" | "net" | "canadian"): GameOutput {
  const out = emptyOutput();
  const cfg = (input.game.config ?? {}) as SkinsConfig;
  const useNet = cfg.net ?? (mode === "net");
  const tiesRule = cfg.ties ?? "carry"; // pot mode default — carry tied holes
  const unclaimed = cfg.unclaimed ?? "refund";
  const requireBirdie = cfg.require_birdie ?? (mode === "canadian");
  const escalation = cfg.escalation ?? "flat";
  // Mode resolution: explicit config wins; else infer from which value field
  // was set; else default to "pot" (the user's preferred default).
  const skinMode: "pot" | "fixed" =
    cfg.skin_mode ?? (cfg.skin_value_cents != null ? "fixed" : "pot");
  const buyinCents = cfg.buyin_cents ?? input.game.stake_cents;
  const baseValue =
    cfg.skin_value_cents ?? Math.floor(input.game.stake_cents / Math.max(1, input.course.holes.length));

  if (input.players.length < 2) return out;
  if (skinMode === "fixed" && baseValue <= 0) return out;
  if (skinMode === "pot" && buyinCents <= 0) return out;

  const sheets = new Map(
    input.players.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  const playerIds = input.players.map((p) => p.id);
  for (const id of playerIds) addDelta(out.perPlayer, id, 0, "");

  const orderedHoles = holesInPlay(input);
  let carry = 0;
  type Award = { hole: number; winner: UUID; value: number; netSum: number };
  const awards: Award[] = [];

  for (const h of orderedHoles) {
    type Entry = { id: UUID; gross: number | null; net: number | null; par: number };
    const entries: Entry[] = [];
    for (const p of input.players) {
      const sheet = sheets.get(p.id)!;
      const row = sheet.rows.find((r) => r.hole_number === h.hole_number);
      entries.push({
        id: p.id,
        gross: row?.gross ?? null,
        net: row?.net ?? null,
        par: h.par
      });
    }
    if (entries.some((e) => (useNet ? e.net : e.gross) === null)) {
      continue;
    }

    const score = (e: Entry) => (useNet ? (e.net as number) : (e.gross as number));
    const lowest = Math.min(...entries.map(score));
    const winners = entries.filter((e) => score(e) === lowest);

    let validated = true;
    if (requireBirdie) {
      validated = lowest < h.par;
    }

    // In pot mode "split" doesn't make sense (no per-hole pot to split) — fall
    // back to carry behavior. Pot mode + nullify simply skips the hole.
    const effectiveTies =
      skinMode === "pot" && tiesRule === "split" ? "carry" : tiesRule;

    if (winners.length > 1 || !validated) {
      if (effectiveTies === "carry" || !validated) {
        carry += 1;
      } else if (effectiveTies === "split") {
        // Fixed-mode split distribution (legacy behavior).
        const winnerIds = winners.map((w) => w.id);
        const loserIds = playerIds.filter((id) => !winnerIds.includes(id));
        if (loserIds.length > 0) {
          const value = computeSkinValue(baseValue, carry, escalation);
          const eachOwes = Math.floor(value / loserIds.length);
          const owedRemainder = value - eachOwes * loserIds.length;
          let collected = 0;
          const sortedLosers = [...loserIds].sort();
          sortedLosers.forEach((id, i) => {
            const owe = eachOwes + (i < owedRemainder ? 1 : 0);
            addDelta(out.perPlayer, id, -owe, `skin split h${h.hole_number}`);
            collected += owe;
          });
          const sortedWinners = [...winnerIds].sort();
          const eachGets = Math.floor(collected / sortedWinners.length);
          const gotRemainder = collected - eachGets * sortedWinners.length;
          sortedWinners.forEach((id, i) => {
            const got = eachGets + (i < gotRemainder ? 1 : 0);
            addDelta(out.perPlayer, id, +got, `skin split h${h.hole_number}`);
          });
        }
        carry = 0;
      } else {
        // nullify
        carry = 0;
      }
      continue;
    }

    const value = computeSkinValue(baseValue, carry, escalation);
    awards.push({ hole: h.hole_number, winner: winners[0].id, value, netSum: 0 });
    carry = 0;
  }

  // -------- Money distribution --------
  if (skinMode === "pot") {
    // Pot mode: every player paid `buyinCents` upfront. Total pot is divided
    // equally among the skins won. If zero skins were won, pot is refunded
    // (no money moves).
    const totalSkins = awards.length;
    const pot = buyinCents * input.players.length;
    if (totalSkins > 0) {
      const valuePerSkin = Math.floor(pot / totalSkins);
      const skinsByPlayer = new Map<UUID, number>();
      for (const a of awards) {
        skinsByPlayer.set(a.winner, (skinsByPlayer.get(a.winner) ?? 0) + 1);
      }
      for (const pid of playerIds) {
        const won = (skinsByPlayer.get(pid) ?? 0) * valuePerSkin;
        addDelta(out.perPlayer, pid, won - buyinCents, "pot skins");
      }
      // Rounding remainder → first sorted winner (deterministic).
      const distributed = totalSkins * valuePerSkin;
      const remainder = pot - distributed;
      if (remainder > 0) {
        const sortedWinners = [...skinsByPlayer.keys()].sort();
        addDelta(out.perPlayer, sortedWinners[0], remainder, "pot rounding");
      }
    }
    // Augment each award with its share of the pot for highlights.
    if (totalSkins > 0) {
      const valuePerSkin = Math.floor(pot / totalSkins);
      for (const a of awards) a.value = valuePerSkin;
    }
  } else {
    // Fixed mode: each skin awards a fixed value, sourced equally from non-winners.
    for (const a of awards) {
      const others = playerIds.filter((id) => id !== a.winner);
      if (others.length === 0) continue;
      const each = Math.floor(a.value / others.length);
      const remainder = a.value - each * others.length;
      let collected = 0;
      others.forEach((id, i) => {
        const owe = each + (i < remainder ? 1 : 0);
        addDelta(out.perPlayer, id, -owe, `skin h${a.hole}`);
        collected += owe;
      });
      addDelta(out.perPlayer, a.winner, collected, `skin h${a.hole}`);
    }
  }

  // Trailing carry handling.
  if (carry > 0) {
    const finalValue = computeSkinValue(baseValue, carry, escalation);
    if (unclaimed === "refund") {
      // do nothing — pot was never put in (in this engine, money only moves on awards).
    } else if (unclaimed === "split_winners" && awards.length > 0) {
      const winnerIds = Array.from(new Set(awards.map((a) => a.winner)));
      const others = playerIds.filter((id) => !winnerIds.includes(id));
      const totalIn = finalValue * others.length;
      if (totalIn > 0 && winnerIds.length > 0) {
        const each = Math.floor(totalIn / winnerIds.length);
        const remainder = totalIn - each * winnerIds.length;
        others.forEach((id) => addDelta(out.perPlayer, id, -finalValue, "carry split to winners"));
        winnerIds.forEach((w, i) =>
          addDelta(out.perPlayer, w, each + (i < remainder ? 1 : 0), "carry split to winners")
        );
      }
    } else {
      // split_all_players: nobody loses; the pot effectively returns. No money moves.
    }
  }

  out.highlights = awards.map((a) => ({
    hole: a.hole,
    label: `skin: ${shortName(input.players, a.winner)}${a.value > baseValue ? ` (×${Math.round(a.value / baseValue)})` : ""}`
  }));
  // "final" once every hole-in-play has a score for every player. Trailing
  // carry is handled by the engine's unclaimed-pot rules above (split,
  // refund, etc.) — it doesn't keep the round in "live" forever.
  const everyHoleScored = input.players.length > 0 && orderedHoles.length > 0 && orderedHoles.every((h) =>
    input.players.every((p) => {
      const sheet = sheets.get(p.id)!;
      const row = sheet.rows.find((r) => r.hole_number === h.hole_number);
      return useNet ? row?.net != null : row?.gross != null;
    })
  );
  out.status = everyHoleScored ? "final" : "live";
  return out;
}

function computeSkinValue(base: number, carryBefore: number, escalation: SkinsConfig["escalation"]): number {
  if (escalation === "double") return base * 2 ** carryBefore;
  if (escalation === "linear") return base * (carryBefore + 1);
  return base; // flat: carry doesn't change value, but this hole counts for value × (carryBefore + 1)
                  // For "flat" mode, the more common interpretation is that carry adds linearly to the skin.
                  // We choose: flat = base value; linear = base × (carryBefore + 1); double = base × 2^carryBefore.
                  // Groups can pick linear if they want classic carry.
}

function shortName(players: GameInput["players"], id: UUID): string {
  const p = players.find((x) => x.id === id);
  return p?.display_name?.split(" ")[0] ?? id.slice(0, 4);
}
