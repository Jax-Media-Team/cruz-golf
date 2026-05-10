/**
 * Catalog of game presets used by both the round-creation page and the
 * in-round games editor. Single source of truth for label/description copy
 * and sensible default stakes/configs.
 *
 * Two views:
 *  - GAME_LIBRARY: flat list of every concrete game_type (used for stats,
 *    leaderboard labels, and direct lookup by game_type).
 *  - GAME_FAMILIES: grouped picker model used by the AddGameForm UI. Each
 *    family has a label and either:
 *      • a single game_type, OR
 *      • a list of variants (e.g. Standard / Canadian for Skins),
 *    plus an optional gross/net mode that resolves to the right concrete
 *    game_type at insert time.
 */
import type { GameType } from "../types";

export type GamePreset = {
  game_type: GameType;
  label: string;
  short: string; // 1-line plain-English summary
  defaults: {
    stake_cents: number;
    allowance_pct: number;
    config: Record<string, unknown>;
  };
  // True if this game family has a gross/net variant pair we can swap.
  hasGrossNetToggle: boolean;
  // Sibling game_type for the gross/net swap (if any).
  toggleTo?: GameType;
};

export const GAME_LIBRARY: GamePreset[] = [
  {
    game_type: "individual_gross",
    label: "Individual gross",
    short: "Lowest gross score wins the pot.",
    defaults: { stake_cents: 1000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "individual_net"
  },
  {
    game_type: "individual_net",
    label: "Individual net",
    short: "Lowest net score wins; handicap evens it out.",
    defaults: { stake_cents: 1000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "individual_gross"
  },
  {
    game_type: "best_ball_gross",
    label: "Best ball (gross)",
    short: "Two-person team — count the lower gross score per hole.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "best_ball_net"
  },
  {
    game_type: "best_ball_net",
    label: "Best ball (net)",
    short: "Two-person team — lower net score per hole, full handicaps.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "best_ball_gross"
  },
  {
    game_type: "aggregate_gross",
    label: "Aggregate (gross)",
    short: "Team score = sum of all members' gross scores per hole.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "aggregate_net"
  },
  {
    game_type: "aggregate_net",
    label: "Aggregate (net)",
    short: "Team score = sum of all members' net scores per hole.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "aggregate_gross"
  },
  {
    game_type: "scramble_gross",
    label: "Scramble (gross)",
    short: "Pick the best shot each turn; lowest team gross per hole.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "scramble_net"
  },
  {
    game_type: "scramble_net",
    label: "Scramble (net)",
    short: "Pick the best shot; lowest team net per hole.",
    defaults: { stake_cents: 2000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: true,
    toggleTo: "scramble_gross"
  },
  {
    game_type: "skins_gross",
    label: "Skins (gross)",
    short: "Lowest gross score on a hole wins a skin; ties carry over.",
    defaults: { stake_cents: 0, allowance_pct: 100, config: { skin_value_cents: 200 } },
    hasGrossNetToggle: true,
    toggleTo: "skins_net"
  },
  {
    game_type: "skins_net",
    label: "Skins (net)",
    short: "Lowest net score on a hole wins a skin; ties carry over.",
    defaults: { stake_cents: 0, allowance_pct: 100, config: { skin_value_cents: 200 } },
    hasGrossNetToggle: true,
    toggleTo: "skins_gross"
  },
  {
    game_type: "skins_canadian",
    label: "Skins (Canadian)",
    short: "Birdie or better required to win a skin (lots of carryovers).",
    defaults: { stake_cents: 0, allowance_pct: 100, config: { skin_value_cents: 500 } },
    hasGrossNetToggle: false
  },
  {
    game_type: "nassau",
    label: "Nassau",
    short: "Three bets: front 9 + back 9 + overall, plus optional presses.",
    defaults: {
      stake_cents: 0,
      allowance_pct: 100,
      config: {
        front_stake_cents: 1000,
        back_stake_cents: 1000,
        overall_stake_cents: 1000,
        presses_enabled: true,
        match_play: false
      }
    },
    hasGrossNetToggle: false
  },
  {
    game_type: "match_play",
    label: "Match play",
    short: "Hole-by-hole match — winner of more holes wins the bet.",
    defaults: { stake_cents: 1000, allowance_pct: 100, config: {} },
    hasGrossNetToggle: false
  },
  {
    game_type: "six_six_six",
    label: "6–6–6",
    short: "Three 6-hole segments, partners rotate. Three small pots.",
    defaults: { stake_cents: 500, allowance_pct: 100, config: {} },
    hasGrossNetToggle: false
  },
  {
    game_type: "ctp",
    label: "Closest to the pin",
    short: "Side bet: closest tee shot on a par 3 wins.",
    defaults: { stake_cents: 0, allowance_pct: 100, config: { hole_number: null } },
    hasGrossNetToggle: false
  },
  {
    game_type: "long_drive",
    label: "Long drive",
    short: "Side bet: longest drive on a designated hole wins.",
    defaults: { stake_cents: 0, allowance_pct: 100, config: { hole_number: null } },
    hasGrossNetToggle: false
  },
  {
    game_type: "custom",
    label: "Custom",
    short: "Manually pick the winners and split — for prop bets.",
    defaults: { stake_cents: 0, allowance_pct: 100, config: {} },
    hasGrossNetToggle: false
  }
];

export function getPreset(t: GameType): GamePreset | undefined {
  return GAME_LIBRARY.find((g) => g.game_type === t);
}

/**
 * Display labels for stat/leaderboard contexts.
 */
export function gameLabel(t: GameType): string {
  return getPreset(t)?.label ?? t;
}

/**
 * Family-grouped picker model. The UI presents a single dropdown of family
 * keys, then renders the family's variants and (when applicable) a
 * Gross/Net mode toggle. Resolves to a concrete GameType at insert time.
 */
export type GameVariant = {
  /** Variant key, unique within the family. Used by the picker. */
  key: string;
  label: string;
  short: string;
  /** Maps (variant, mode) -> concrete game_type. If the family has no
   *  gross/net mode, this returns the same game_type for any mode. */
  resolve: (mode: "gross" | "net" | null) => GameType;
};

export type GameFamily = {
  /** Family key, used by the picker. */
  key: string;
  label: string;
  short: string; // shown when family selected, before variants
  /** When true, show a Gross / Net toggle. When false, no mode is asked. */
  hasMode: boolean;
  /** Default mode when first selected (only used if hasMode). */
  defaultMode?: "gross" | "net";
  /** Default variant key when first selected (must exist in `variants`). */
  defaultVariant: string;
  variants: GameVariant[];
};

export const GAME_FAMILIES: GameFamily[] = [
  {
    key: "individual",
    label: "Individual",
    short: "Lowest score wins the pot.",
    hasMode: true,
    defaultMode: "net",
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Individual",
        short: "Lowest score wins.",
        resolve: (m) => (m === "gross" ? "individual_gross" : "individual_net")
      }
    ]
  },
  {
    key: "best_ball",
    label: "Best ball (2-man)",
    short: "Two-person team. Count the better score on each hole.",
    hasMode: true,
    defaultMode: "net",
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Best ball",
        short: "Lower score per hole, partners pair up.",
        resolve: (m) => (m === "gross" ? "best_ball_gross" : "best_ball_net")
      }
    ]
  },
  {
    key: "aggregate",
    label: "Aggregate (team total)",
    short: "Team score per hole = sum of every partner's score.",
    hasMode: true,
    defaultMode: "net",
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Aggregate",
        short: "All scores count, lowest team total wins.",
        resolve: (m) => (m === "gross" ? "aggregate_gross" : "aggregate_net")
      }
    ]
  },
  {
    key: "scramble",
    label: "Scramble",
    short: "Pick the best shot each turn — team score is the lone result per hole.",
    hasMode: true,
    defaultMode: "gross",
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Scramble",
        short: "Best shot wins each shot.",
        resolve: (m) => (m === "gross" ? "scramble_gross" : "scramble_net")
      }
    ]
  },
  {
    key: "skins",
    label: "Skins",
    short: "Each hole pays one skin. Tie pushes the skin to the next hole.",
    hasMode: true,
    defaultMode: "net",
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Standard skins",
        short: "Lowest score on a hole wins a skin; ties push.",
        resolve: (m) => (m === "gross" ? "skins_gross" : "skins_net")
      },
      {
        key: "canadian",
        label: "Canadian skins",
        short: "Birdie or better required — lots of carryovers and big payouts.",
        resolve: () => "skins_canadian"
      }
    ]
  },
  {
    key: "nassau",
    label: "Nassau",
    short: "Three side bets: front 9, back 9, overall — plus optional presses.",
    hasMode: false,
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "Nassau",
        short: "Three side bets (front / back / overall).",
        resolve: () => "nassau"
      },
      {
        key: "match_play",
        label: "Match play (Nassau-style)",
        short: "Hole-by-hole match for one overall stake.",
        resolve: () => "match_play"
      }
    ]
  },
  {
    key: "six_six_six",
    label: "6–6–6",
    short: "Three 6-hole segments, partners rotate. Three small pots.",
    hasMode: false,
    defaultVariant: "standard",
    variants: [
      {
        key: "standard",
        label: "6–6–6",
        short: "Rotating partners over three segments.",
        resolve: () => "six_six_six"
      }
    ]
  },
  {
    key: "side_bets",
    label: "Side bets",
    short: "Closest to the pin, long drive, or anything else.",
    hasMode: false,
    defaultVariant: "ctp",
    variants: [
      {
        key: "ctp",
        label: "Closest to the pin",
        short: "Closest tee shot on a par 3 wins the pot.",
        resolve: () => "ctp"
      },
      {
        key: "long_drive",
        label: "Long drive",
        short: "Longest drive on a designated hole.",
        resolve: () => "long_drive"
      },
      {
        key: "custom",
        label: "Custom prop bet",
        short: "Manually pick the winner.",
        resolve: () => "custom"
      }
    ]
  }
];

export function getFamily(key: string): GameFamily | undefined {
  return GAME_FAMILIES.find((f) => f.key === key);
}
