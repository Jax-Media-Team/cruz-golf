import type { GameInput, GameOutput } from "../types";
import { addDelta, emptyOutput } from "./helpers";

/**
 * CTP / Long drive / custom side bet.
 * Each hole listed in config.holes (or single hole for long drive) has a per-hole pot.
 * Manual entries declare the winner. Pot per hole = stake_cents × players (per-player buy-in).
 * If no winner declared on a hole, configurable rollover (default: refund — money never moves).
 */
export function settleManualGame(input: GameInput, kind: "ctp" | "long_drive" | "custom"): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;
  const playerIds = input.players.map((p) => p.id);
  for (const id of playerIds) addDelta(out.perPlayer, id, 0, "");
  if (stake <= 0 || input.players.length < 2) return out;

  const entries = (input.manualEntries ?? []).filter((e) => e.round_game_id === input.game.id);
  const cfg = input.game.config as { holes?: number[] } | undefined;
  const holes = cfg?.holes ?? entries.map((e) => e.hole_number).filter((h): h is number => h != null);

  for (const h of holes) {
    const e = entries.find((x) => x.hole_number === h && x.winner_round_player_id);
    if (!e || !e.winner_round_player_id) continue;
    // Each non-winner pays stake; winner collects.
    const losers = playerIds.filter((id) => id !== e.winner_round_player_id);
    let pot = 0;
    for (const id of losers) {
      addDelta(out.perPlayer, id, -stake, `${kind} h${h}`);
      pot += stake;
    }
    addDelta(out.perPlayer, e.winner_round_player_id, pot, `${kind} h${h}`);
  }

  out.status = "live";
  return out;
}
