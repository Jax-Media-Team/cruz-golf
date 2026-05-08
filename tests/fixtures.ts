import type { CourseHole, GameInput, RoundGame, RoundPlayer, Score, UUID } from "@/lib/types";

export function makeHoles(par: number[] = []): CourseHole[] {
  const pars = par.length === 18 ? par : new Array(18).fill(4);
  // Standard SI: 1,11,3,13,5,15,7,17,9,2,12,4,14,6,16,8,18,10 (a typical layout)
  const sis = [7, 11, 3, 13, 5, 15, 9, 17, 1, 8, 12, 4, 14, 6, 16, 10, 18, 2];
  return pars.map((p, i) => ({
    hole_number: i + 1,
    par: p,
    stroke_index: sis[i]
  }));
}

export function makePlayer(opts: {
  id: UUID;
  name: string;
  playing_handicap?: number;
  team_id?: UUID | null;
}): RoundPlayer {
  return {
    id: opts.id,
    player_id: opts.id + "-p",
    display_name: opts.name,
    tee_id: "tee-1",
    tee: {
      id: "tee-1",
      name: "Blue",
      rating: 71.2,
      slope: 132,
      par: 72,
      holes: makeHoles()
    },
    handicap_index_used: 12,
    course_handicap: opts.playing_handicap ?? 0,
    playing_handicap: opts.playing_handicap ?? 0,
    team_id: opts.team_id ?? null
  };
}

export function makeScores(map: Record<UUID, number[]>): Score[] {
  const out: Score[] = [];
  for (const [pid, scores] of Object.entries(map)) {
    scores.forEach((g, i) => out.push({ round_player_id: pid, hole_number: i + 1, gross: g }));
  }
  return out;
}

export function makeGame(overrides: Partial<RoundGame> = {}): RoundGame {
  return {
    id: "game-1",
    round_id: "round-1",
    game_type: "individual_net",
    name: "Individual Net",
    stake_cents: 1000,
    allowance_pct: 100,
    config: {},
    ...overrides
  };
}

export function makeInput(overrides: Partial<GameInput>): GameInput {
  const holes = overrides.course?.holes ?? makeHoles();
  return {
    game: overrides.game ?? makeGame(),
    players: overrides.players ?? [],
    scores: overrides.scores ?? [],
    course: overrides.course ?? { holes, par: holes.reduce((s, h) => s + h.par, 0) },
    manualEntries: overrides.manualEntries,
    startingHole: overrides.startingHole ?? 1,
    totalHoles: overrides.totalHoles ?? 18
  };
}
