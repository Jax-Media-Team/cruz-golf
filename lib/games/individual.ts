import type { GameInput, GameOutput } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, distributeFromLosersToWinner, emptyOutput } from "./helpers";

/**
 * Individual gross or net stroke play.
 * Stake is per-player buy-in. Lowest score wins the pot. Ties split.
 */
export function settleIndividual(input: GameInput, mode: "gross" | "net"): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;
  if (stake <= 0 || input.players.length < 2) return out;

  const sheets = input.players.map((p) =>
    buildPlayerSheet(p, input.scores, input.course.holes)
  );

  // Only count finished players for final, but for live we use current totals.
  const completedAll = sheets.every((s) => s.totals.thru === input.course.holes.length);

  const score = (s: (typeof sheets)[number]) =>
    mode === "gross" ? s.totals.gross : s.totals.net;
  const minScore = Math.min(...sheets.map(score));
  const winners = sheets.filter((s) => score(s) === minScore).map((s) => s.round_player_id);
  const losers = sheets
    .filter((s) => score(s) !== minScore)
    .map((s) => s.round_player_id);

  // Each non-winner pays `stake`. Winner(s) split pot.
  for (const id of input.players.map((p) => p.id)) {
    addDelta(out.perPlayer, id, 0, ""); // ensure entry exists
  }
  distributeFromLosersToWinner(
    out.perPlayer,
    winners,
    losers,
    stake,
    `${mode} stroke play`
  );

  out.status = completedAll ? "final" : "live";
  return out;
}
