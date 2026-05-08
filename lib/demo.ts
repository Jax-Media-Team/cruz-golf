/**
 * Dummy data fixture for the /demo showcase.
 * No Supabase, no auth — just realistic round state to populate the UI.
 *
 * Scenario: A Saturday foursome at Jacksonville Golf & Country Club, thru 14 holes,
 * playing a Friendly Nassau + Net Skins + Best Ball Net.
 */

import type { CourseHole, RoundGame, RoundPlayer, Score } from "./types";

const PARS = [5, 4, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4, 5, 4, 5, 3, 4];
const SI = [13, 7, 17, 3, 15, 5, 11, 1, 9, 16, 2, 12, 8, 18, 6, 14, 10, 4];

export const DEMO_HOLES: CourseHole[] = PARS.map((par, i) => ({
  hole_number: i + 1,
  par,
  stroke_index: SI[i]
}));

export const DEMO_PAR_TOTAL = PARS.reduce((s, p) => s + p, 0);

export const DEMO_COURSE = {
  name: "Jacksonville Golf & Country Club",
  tee_name: "Blue",
  rating: 73.2,
  slope: 138,
  par: 72,
  holes: DEMO_HOLES,
  city: "Jacksonville",
  state: "FL"
};

export const DEMO_PLAYERS: RoundPlayer[] = [
  {
    id: "rp-cruz",
    player_id: "p-cruz",
    display_name: "Cruz",
    tee_id: "tee-blue",
    tee: { id: "tee-blue", name: "Blue", rating: 73.2, slope: 138, par: 72, holes: DEMO_HOLES },
    handicap_index_used: 12.4,
    course_handicap: 14,
    playing_handicap: 13,
    team_id: "t-1"
  },
  {
    id: "rp-jeff",
    player_id: "p-jeff",
    display_name: "Jeff",
    tee_id: "tee-blue",
    tee: { id: "tee-blue", name: "Blue", rating: 73.2, slope: 138, par: 72, holes: DEMO_HOLES },
    handicap_index_used: 8.0,
    course_handicap: 9,
    playing_handicap: 9,
    team_id: "t-2"
  },
  {
    id: "rp-marco",
    player_id: "p-marco",
    display_name: "Marco",
    tee_id: "tee-blue",
    tee: { id: "tee-blue", name: "Blue", rating: 73.2, slope: 138, par: 72, holes: DEMO_HOLES },
    handicap_index_used: 18.6,
    course_handicap: 21,
    playing_handicap: 20,
    team_id: "t-1"
  },
  {
    id: "rp-taylor",
    player_id: "p-taylor",
    display_name: "Taylor",
    tee_id: "tee-blue",
    tee: { id: "tee-blue", name: "Blue", rating: 73.2, slope: 138, par: 72, holes: DEMO_HOLES },
    handicap_index_used: 14.2,
    course_handicap: 16,
    playing_handicap: 15,
    team_id: "t-2"
  }
];

// Hole-by-hole gross scores. Thru 14 holes for everyone, mid-round.
// Pars: 5,4,3,4,4,3,4,5,4,4,4,3,4,5,4,5,3,4
const RAW_SCORES: Record<string, (number | null)[]> = {
  "rp-cruz":   [5, 4, 4, 5, 4, 3, 5, 6, 4, 5, 4, 4, 4, 5, null, null, null, null],
  "rp-jeff":   [4, 4, 3, 4, 4, 3, 4, 5, 4, 4, 4, 4, 3, 5, null, null, null, null],
  "rp-marco":  [6, 5, 5, 6, 5, 4, 6, 7, 5, 6, 5, 4, 5, 6, null, null, null, null],
  "rp-taylor": [5, 5, 4, 5, 4, 3, 5, 6, 4, 5, 5, 3, 4, 5, null, null, null, null]
};

export const DEMO_SCORES: Score[] = (() => {
  const out: Score[] = [];
  for (const [rpId, holes] of Object.entries(RAW_SCORES)) {
    holes.forEach((g, i) => {
      out.push({ round_player_id: rpId, hole_number: i + 1, gross: g });
    });
  }
  return out;
})();

export const DEMO_GAMES: RoundGame[] = [
  {
    id: "g-nassau",
    round_id: "round-demo",
    game_type: "nassau",
    name: "Friendly Nassau",
    stake_cents: 500,
    allowance_pct: 100,
    config: {
      match_play: true,
      front_stake_cents: 500,
      back_stake_cents: 500,
      overall_stake_cents: 1000,
      presses: "none"
    }
  },
  {
    id: "g-skins",
    round_id: "round-demo",
    game_type: "skins_net",
    name: "Net Skins",
    stake_cents: 0,
    allowance_pct: 100,
    config: { skin_value_cents: 100, ties: "split", escalation: "linear" }
  },
  {
    id: "g-best-ball",
    round_id: "round-demo",
    game_type: "best_ball_net",
    name: "2-man Best Ball (Net)",
    stake_cents: 1000,
    allowance_pct: 85,
    config: {}
  }
];

export const DEMO_ROUND = {
  id: "round-demo",
  date: "2026-05-08",
  holes: 18 as 9 | 18,
  status: "live" as const,
  course_name: DEMO_COURSE.name,
  spectator_token: "demo"
};

export type DemoPlayerProfile = {
  id: string;
  display_name: string;
  handicap_index: number;
  ghin_number?: string;
  venmo_handle: string;
  avatar_url: string | null;
  rounds_played: number;
  rounds_jgcc: number;
  avg_gross_18: number;
  avg_net_18: number;
  jgcc_avg: number;
  season_net_cents: number;
  buckets: { eagle_or_better: number; birdie: number; par: number; bogey: number; double: number; other: number };
  total_holes: number;
};

export const DEMO_PROFILES: Record<string, DemoPlayerProfile> = {
  "p-cruz": {
    id: "p-cruz",
    display_name: "Cruz",
    handicap_index: 12.4,
    ghin_number: "1234567",
    venmo_handle: "cruz-jax",
    avatar_url: null,
    rounds_played: 14,
    rounds_jgcc: 9,
    avg_gross_18: 84.6,
    avg_net_18: 71.2,
    jgcc_avg: 83.1,
    season_net_cents: 4750,
    buckets: { eagle_or_better: 1, birdie: 12, par: 88, bogey: 102, double: 38, other: 11 },
    total_holes: 252
  },
  "p-jeff": {
    id: "p-jeff",
    display_name: "Jeff",
    handicap_index: 8.0,
    venmo_handle: "jeff-the-grinder",
    avatar_url: null,
    rounds_played: 14,
    rounds_jgcc: 8,
    avg_gross_18: 80.4,
    avg_net_18: 72.4,
    jgcc_avg: 79.8,
    season_net_cents: 11200,
    buckets: { eagle_or_better: 0, birdie: 21, par: 119, bogey: 88, double: 18, other: 6 },
    total_holes: 252
  },
  "p-marco": {
    id: "p-marco",
    display_name: "Marco",
    handicap_index: 18.6,
    venmo_handle: "marco-mulligan",
    avatar_url: null,
    rounds_played: 12,
    rounds_jgcc: 7,
    avg_gross_18: 92.8,
    avg_net_18: 73.7,
    jgcc_avg: 91.4,
    season_net_cents: -7800,
    buckets: { eagle_or_better: 0, birdie: 4, par: 41, bogey: 96, double: 56, other: 19 },
    total_holes: 216
  },
  "p-taylor": {
    id: "p-taylor",
    display_name: "Taylor",
    handicap_index: 14.2,
    venmo_handle: "taylor-tee",
    avatar_url: null,
    rounds_played: 13,
    rounds_jgcc: 8,
    avg_gross_18: 87.3,
    avg_net_18: 72.8,
    jgcc_avg: 86.0,
    season_net_cents: -8150,
    buckets: { eagle_or_better: 0, birdie: 9, par: 71, bogey: 99, double: 42, other: 13 },
    total_holes: 234
  }
};

export const DEMO_RECENT_ROUNDS = [
  { id: "r-2026-05-01", date: "2026-05-01", course: "Jacksonville G&CC", gross: 84, net: 70, vsPar: 12 },
  { id: "r-2026-04-24", date: "2026-04-24", course: "Sawgrass CC", gross: 88, net: 74, vsPar: 16 },
  { id: "r-2026-04-17", date: "2026-04-17", course: "Jacksonville G&CC", gross: 81, net: 67, vsPar: 9 },
  { id: "r-2026-04-10", date: "2026-04-10", course: "Jacksonville G&CC", gross: 86, net: 72, vsPar: 14 },
  { id: "r-2026-04-03", date: "2026-04-03", course: "Hidden Hills", gross: 89, net: 75, vsPar: 17 }
];
