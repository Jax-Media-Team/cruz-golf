import type { GameInput, GameOutput, UUID } from "../types";
import { settleIndividual } from "./individual";
import { settleSkins } from "./skins";
import { settleTeamGame } from "./team";
import { settleNassau } from "./nassau";
import { settleSixSixSix } from "./six_six_six";
import { settleManualGame } from "./manual";
import { assertZeroSum } from "./helpers";

export function settleGame(input: GameInput): GameOutput {
  const t = input.game.game_type;
  let out: GameOutput;
  switch (t) {
    case "individual_gross":
      out = settleIndividual(input, "gross");
      break;
    case "individual_net":
      out = settleIndividual(input, "net");
      break;
    case "best_ball_gross":
      out = settleTeamGame(input, "best_ball", "gross");
      break;
    case "best_ball_net":
      out = settleTeamGame(input, "best_ball", "net");
      break;
    case "aggregate_gross":
      out = settleTeamGame(input, "aggregate", "gross");
      break;
    case "aggregate_net":
      out = settleTeamGame(input, "aggregate", "net");
      break;
    case "skins_gross":
      out = settleSkins(input, "gross");
      break;
    case "skins_net":
      out = settleSkins(input, "net");
      break;
    case "skins_canadian":
      out = settleSkins(input, "canadian");
      break;
    case "nassau":
      out = settleNassau(input);
      break;
    case "match_play":
      // Match play is a Nassau with overall-only stake.
      out = settleNassau({ ...input, game: { ...input.game, config: { ...(input.game.config ?? {}), match_play: true, front_stake_cents: 0, back_stake_cents: 0, overall_stake_cents: input.game.stake_cents } } });
      break;
    case "six_six_six":
      out = settleSixSixSix(input);
      break;
    case "ctp":
      out = settleManualGame(input, "ctp");
      break;
    case "long_drive":
      out = settleManualGame(input, "long_drive");
      break;
    case "custom":
      out = settleManualGame(input, "custom");
      break;
    default:
      throw new Error(`Unknown game_type: ${t satisfies never}`);
  }
  assertZeroSum(out);
  return out;
}

/**
 * Greedy minimum-flow settlement: who pays whom across all games.
 */
export function minimumFlow(perPlayer: Map<UUID, number>): Array<{
  from: UUID;
  to: UUID;
  amount_cents: number;
}> {
  const out: Array<{ from: UUID; to: UUID; amount_cents: number }> = [];
  const balances = [...perPlayer.entries()].map(([id, v]) => ({ id, v }));
  while (true) {
    balances.sort((a, b) => a.v - b.v);
    const debtor = balances[0];
    const creditor = balances[balances.length - 1];
    if (!debtor || !creditor) break;
    if (debtor.v >= 0 || creditor.v <= 0) break;
    const amt = Math.min(-debtor.v, creditor.v);
    out.push({ from: debtor.id, to: creditor.id, amount_cents: amt });
    debtor.v += amt;
    creditor.v -= amt;
  }
  return out;
}
