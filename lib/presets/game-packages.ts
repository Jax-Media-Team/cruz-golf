import type { GameType } from "@/lib/types";

export type PackageGame = {
  game_type: GameType;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: Record<string, unknown>;
};

export type GamePackage = {
  id: string;
  label: string;
  blurb: string;
  emoji: string;
  games: PackageGame[];
};

export const GAME_PACKAGES: GamePackage[] = [
  {
    id: "gentlemans",
    label: "Gentleman's bet",
    blurb: "$5 individual net. One game, one winner. No skins, no presses.",
    emoji: "🤝",
    games: [
      { game_type: "individual_net", name: "Individual net", stake_cents: 500, allowance_pct: 100, config: {} }
    ]
  },
  {
    id: "friendly_nassau",
    label: "Friendly Nassau",
    blurb: "$5 / $5 / $10 match-play Nassau. No presses. Polite group.",
    emoji: "⛳",
    games: [
      {
        game_type: "nassau",
        name: "Nassau (5/5/10)",
        stake_cents: 500,
        allowance_pct: 100,
        config: { match_play: true, front_stake_cents: 500, back_stake_cents: 500, overall_stake_cents: 1000, presses: "none" }
      }
    ]
  },
  {
    id: "aggressive_nassau",
    label: "Aggressive Nassau",
    blurb: "$10 / $10 / $20 with auto-press at 2 down. Wallets out.",
    emoji: "🔥",
    games: [
      {
        game_type: "nassau",
        name: "Nassau (10/10/20, auto-press)",
        stake_cents: 1000,
        allowance_pct: 100,
        config: { match_play: true, front_stake_cents: 1000, back_stake_cents: 1000, overall_stake_cents: 2000, presses: "auto_2_down" }
      }
    ]
  },
  {
    id: "quarter_skins",
    label: "Quarter skins",
    blurb: "Net skins, $0.25 each, ties carry, value doubles after a carry.",
    emoji: "🍀",
    games: [
      {
        game_type: "skins_net",
        name: "Net skins (25¢, doubling)",
        stake_cents: 0,
        allowance_pct: 100,
        config: { skin_value_cents: 25, ties: "carry", escalation: "double", unclaimed: "split_winners" }
      }
    ]
  },
  {
    id: "canadian",
    label: "Canadian skins",
    blurb: "Birdie validates. Carry on tie or no birdie. Linear escalation.",
    emoji: "🍁",
    games: [
      {
        game_type: "skins_canadian",
        name: "Canadian skins (birdie validates)",
        stake_cents: 0,
        allowance_pct: 100,
        config: { skin_value_cents: 100, require_birdie: true, escalation: "linear", ties: "carry", unclaimed: "split_winners" }
      }
    ]
  },
  {
    id: "three_way",
    label: "Three-way",
    blurb: "Individual net + 2-man best ball + net skins. Three settlements.",
    emoji: "♣",
    games: [
      { game_type: "individual_net", name: "Individual net", stake_cents: 500, allowance_pct: 95, config: {} },
      { game_type: "best_ball_net", name: "Best ball net", stake_cents: 1000, allowance_pct: 85, config: {} },
      {
        game_type: "skins_net",
        name: "Net skins",
        stake_cents: 0,
        allowance_pct: 100,
        config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
      }
    ]
  },
  {
    id: "members_day",
    label: "Members' day",
    blurb: "Team aggregate net + closest-to-pin pot on every par-3.",
    emoji: "🏆",
    games: [
      { game_type: "aggregate_net", name: "Team aggregate net", stake_cents: 2000, allowance_pct: 100, config: {} },
      { game_type: "ctp", name: "Closest to the pin", stake_cents: 500, allowance_pct: 100, config: { holes: [3, 6, 12, 17] } }
    ]
  }
];
