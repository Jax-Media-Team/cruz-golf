import type { GameInput, GameOutput } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, applyAllowance, distributeFromLosersToWinner, emptyOutput, holesInPlay } from "./helpers";

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

  const inPlay = holesInPlay(input);
  const adjusted = mode === "net" ? applyAllowance(input.players, input.game.allowance_pct) : input.players;
  const sheets = adjusted.map((p) =>
    buildPlayerSheet(p, input.scores, inPlay)
  );

  // "Complete" = every hole-in-play has a score for every player. (We can't
  // use totals.thru === courseHoles because thru is the last hole_number
  // played, not a count — on a back-9 round thru is 18 even after one hole.)
  const completedAll =
    inPlay.length > 0 &&
    inPlay.every((h) =>
      sheets.every((s) => s.rows.find((r) => r.hole_number === h.hole_number)?.gross != null)
    );

  // Count how many holes each player has scored (not the hole number, the
  // tally) — used for the "everyone on the same hole" projection guard.
  const playedCountByPlayer = sheets.map((s) =>
    s.rows.reduce((n, r) => n + (r.gross != null ? 1 : 0), 0)
  );

  // Live projection only when everyone has played the same number of holes.
  // (Counting played holes, not the highest played hole — handles wraparound
  // and back-9-only rounds correctly.)
  const sameCount = new Set(playedCountByPlayer).size === 1;
  const allStarted = playedCountByPlayer.every((n) => n > 0);

  if (!sameCount || !allStarted) {
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
