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

/**
 * Generic, opinion-free Quick Start packages — one per common game type
 * with sensible defaults. Personalized presets ("Friendly Nassau",
 * "Aggressive Nassau", "Quarter Skins") used to live here; they were too
 * specific to one group's vibe and ended up as noise. Users now save
 * their own setups via the "Save as preset" button on /rounds/new.
 */
export const GAME_PACKAGES: GamePackage[] = [
  {
    id: "individual_net",
    label: "Individual",
    blurb: "Lowest net score wins the pot. Simple and works with any group size.",
    emoji: "👤",
    games: [
      { game_type: "individual_net", name: "Individual (net)", stake_cents: 1000, allowance_pct: 100, config: {} }
    ]
  },
  {
    id: "skins",
    label: "Skins",
    blurb: "Each hole pays one skin. Tie pushes the skin to the next hole.",
    emoji: "🍀",
    games: [
      {
        game_type: "skins_net",
        name: "Skins (net)",
        stake_cents: 0,
        allowance_pct: 100,
        config: { skin_value_cents: 200, ties: "carry", escalation: "linear" }
      }
    ]
  },
  {
    id: "nassau",
    label: "Nassau",
    blurb: "Three side bets: front 9, back 9, overall. Optional presses.",
    emoji: "⛳",
    games: [
      {
        game_type: "nassau",
        name: "Nassau",
        stake_cents: 0,
        allowance_pct: 100,
        config: {
          match_play: true,
          front_stake_cents: 1000,
          back_stake_cents: 1000,
          overall_stake_cents: 1000,
          presses_enabled: true
        }
      }
    ]
  },
  {
    id: "best_ball",
    label: "Best ball",
    blurb: "Two-person team. Lower score on each hole counts.",
    emoji: "🤝",
    games: [
      { game_type: "best_ball_net", name: "Best ball (net)", stake_cents: 2000, allowance_pct: 85, config: {} }
    ]
  },
  {
    id: "scramble",
    label: "Scramble",
    blurb: "Pick the best shot every turn. One score per team per hole.",
    emoji: "🎯",
    games: [
      { game_type: "scramble_gross", name: "Scramble", stake_cents: 2000, allowance_pct: 100, config: {} }
    ]
  },
  {
    id: "six_six_six",
    label: "6–6–6",
    blurb: "Three 6-hole segments. Partners rotate every 6 holes.",
    emoji: "♻️",
    games: [
      { game_type: "six_six_six", name: "6–6–6", stake_cents: 500, allowance_pct: 100, config: {} }
    ]
  }
];
