import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput, holesInPlay } from "./helpers";

type SkinsConfig = {
  net?: boolean;
  skin_value_cents?: number;
  ties?: "carry" | "split" | "nullify";
  unclaimed?: "split_all_players" | "split_winners" | "refund";
  // Canadian-style options:
  require_birdie?: boolean;
  escalation?: "flat" | "linear" | "double";
};

/**
 * Generic skins engine. Used by skins_gross, skins_net, skins_canadian.
 */
export function settleSkins(input: GameInput, mode: "gross" | "net" | "canadian"): GameOutput {
  const out = emptyOutput();
  const cfg = (input.game.config ?? {}) as SkinsConfig;
  const useNet = cfg.net ?? (mode === "net");
  // Default ties to "split" — most groups don't want auto-carry.
  // Canadian's distinguishing feature is birdie validation, not auto-carry.
  const tiesRule = cfg.ties ?? "split";
  const unclaimed = cfg.unclaimed ?? "split_all_players";
  const requireBirdie = cfg.require_birdie ?? (mode === "canadian");
  const escalation = cfg.escalation ?? "flat";
  const baseValue =
    cfg.skin_value_cents ?? Math.floor(input.game.stake_cents / Math.max(1, input.course.holes.length));

  if (input.players.length < 2 || baseValue <= 0) return out;

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
    // Collect each player's score on this hole.
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
    // If anyone hasn't played the hole yet, treat it as "not yet decided" and
    // skip — but keep evaluating later holes that ARE complete. Carry is NOT
    // incremented for an undecided hole (it just stays where it was).
    if (entries.some((e) => (useNet ? e.net : e.gross) === null)) {
      continue;
    }

    const score = (e: Entry) => (useNet ? (e.net as number) : (e.gross as number));
    const lowest = Math.min(...entries.map(score));
    const winners = entries.filter((e) => score(e) === lowest);

    let validated = true;
    if (requireBirdie) {
      // For net: birdie = net at least one under par. For gross: gross under par.
      const winningScore = lowest;
      validated = winningScore < h.par;
    }

    if (winners.length > 1 || !validated) {
      if (tiesRule === "carry" || !validated) {
        carry += 1;
      } else if (tiesRule === "split") {
        // Tied winners split the pot, sourced from the non-tied losers.
        // If everybody ties (no losers), no money moves and carry resets.
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
        // nullify: nobody gets this hole; carry resets.
        carry = 0;
      }
      continue;
    }

    const value = computeSkinValue(baseValue, carry, escalation);
    awards.push({ hole: h.hole_number, winner: winners[0].id, value, netSum: 0 });
    carry = 0;
  }

  // Apply each awarded skin: every other player pays equal share of `value`.
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
