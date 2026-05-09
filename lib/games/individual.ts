import type { GameInput, GameOutput } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, distributeFromLosersToWinner, emptyOutput } from "./helpers";

/**
 * Individual gross or net stroke play.
 * Stake is per-player buy-in. Lowest score wins the pot. Ties split.
 *
 * Live projection rule: only project a winner when every player has played
 * the SAME number of holes. Otherwise the un-scored players' totals are 0
 * and they would falsely "lead" — making the Bets tab show the actual
 * scorer as down money. When `thru` counts disagree, return $0 for
 * everyone with status "live" so the user sees a clean pending state.
 */
export function settleIndividual(input: GameInput, mode: "gross" | "net"): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;

  // Always pre-populate every player at $0 so the UI always knows about them.
  for (const id of input.players.map((p) => p.id)) {
    addDelta(out.perPlayer, id, 0, "");
  }

  if (stake <= 0 || input.players.length < 2) return out;

  const sheets = input.players.map((p) =>
    buildPlayerSheet(p, input.scores, input.course.holes)
  );

  const courseHoles = input.course.holes.length;
  const completedAll = sheets.every((s) => s.totals.thru === courseHoles);

  // Live projection only when everyone is on the same hole. This avoids the
  // "un-scored players have totals=0 and steal the lead" trap.
  const thrus = new Set(sheets.map((s) => s.totals.thru));
  const sameThru = thrus.size === 1;
  const allStarted = sheets.every((s) => s.totals.thru > 0);

  if (!sameThru || !allStarted) {
    out.status = "live";
    return out;
  }

  const score = (s: (typeof sheets)[number]) =>
    mode === "gross" ? s.totals.gross : s.totals.net;
  const minScore = Math.min(...sheets.map(score));
  const winners = sheets.filter((s) => score(s) === minScore).map((s) => s.round_player_id);
  const losers = sheets
    .filter((s) => score(s) !== minScore)
    .map((s) => s.round_player_id);

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
