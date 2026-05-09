/**
 * Catalog of game presets used by both the round-creation page and the
 * in-round games editor. Single source of truth for label/description copy
 * and sensible default stakes/configs.
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
