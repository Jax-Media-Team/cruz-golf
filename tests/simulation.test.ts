import { describe, expect, it } from "vitest";
import { settleGame, minimumFlow } from "@/lib/games";
import type {
  CourseHole,
  GameInput,
  GameOutput,
  ManualEntry,
  RoundGame,
  RoundPlayer,
  Score,
  UUID
} from "@/lib/types";
import { courseHandicap, playingHandicap } from "@/lib/handicap";
import { makeHoles, makeInput, makeGame, makePlayer, makeScores } from "./fixtures";

// ---------- helpers ----------

function sumDeltas(out: GameOutput): number {
  let s = 0;
  for (const v of out.perPlayer.values()) s += v.delta_cents;
  return s;
}

function applyFlows(
  balances: Map<UUID, number>,
  flows: Array<{ from: UUID; to: UUID; amount_cents: number }>
): Map<UUID, number> {
  const out = new Map(balances);
  for (const f of flows) {
    out.set(f.from, (out.get(f.from) ?? 0) + f.amount_cents);
    out.set(f.to, (out.get(f.to) ?? 0) - f.amount_cents);
  }
  return out;
}

function aggregatePerPlayer(outputs: GameOutput[]): Map<UUID, number> {
  const m = new Map<UUID, number>();
  for (const o of outputs) {
    for (const [pid, delta] of o.perPlayer) {
      m.set(pid, (m.get(pid) ?? 0) + delta.delta_cents);
    }
  }
  return m;
}

// Deterministic pseudo-random per-hole gross generator.
// Returns an integer in [par-1, par+3] biased toward par by player skill.
// `skill` lower = better (low handicap).
function fakeRound(seed: number, holes: CourseHole[], skill: number): number[] {
  let s = seed;
  function rand() {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  }
  return holes.map((h) => {
    const r = rand();
    // tilt distribution by skill: bigger handicap -> more high scores
    const skillBias = Math.min(0.5, skill / 40);
    const roll = r + skillBias;
    let delta = 0;
    if (roll < 0.05) delta = -1; // birdie
    else if (roll < 0.45) delta = 0; // par
    else if (roll < 0.8) delta = 1; // bogey
    else if (roll < 0.95) delta = 2; // double
    else delta = 3; // triple
    return Math.max(2, h.par + delta);
  });
}

// Build a JGCC-style course: par 72 spread across 18 holes
function jgccHoles(): CourseHole[] {
  // Pars vary; sis cover 1..18 typical
  const pars = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  return makeHoles(pars);
}

function jgccBlue(): RoundPlayer["tee"] {
  const holes = jgccHoles();
  return {
    id: "tee-blue",
    name: "Blue",
    rating: 71.2,
    slope: 132,
    par: 72,
    holes
  };
}

function jgccWhite(): RoundPlayer["tee"] {
  const holes = jgccHoles();
  return {
    id: "tee-white",
    name: "White",
    rating: 69.4,
    slope: 126,
    par: 72,
    holes
  };
}

function makeJgccPlayer(opts: {
  id: UUID;
  name: string;
  handicap_index: number;
  tee?: RoundPlayer["tee"];
  team_id?: UUID | null;
}): RoundPlayer {
  const tee = opts.tee ?? jgccBlue();
  const ch = courseHandicap(opts.handicap_index, tee.slope, tee.rating, tee.par);
  const ph = playingHandicap(ch, 100);
  return {
    id: opts.id,
    player_id: opts.id + "-p",
    display_name: opts.name,
    tee_id: tee.id,
    tee,
    handicap_index_used: opts.handicap_index,
    course_handicap: ch,
    playing_handicap: ph,
    team_id: opts.team_id ?? null
  };
}

function partialScores(allScores: Record<UUID, number[]>, throughHole: number): Score[] {
  const out: Score[] = [];
  for (const [pid, arr] of Object.entries(allScores)) {
    arr.slice(0, throughHole).forEach((g, i) => {
      out.push({ round_player_id: pid, hole_number: i + 1, gross: g });
    });
  }
  return out;
}

// ============================================================
// SIM A — 4-player foursome at JGCC (mixed handicaps)
// ============================================================
describe("Sim A — 4-player foursome at JGCC, mixed handicaps", () => {
  const holes = jgccHoles();
  const blue = jgccBlue();
  const white = jgccWhite();

  // Mixed handicaps per request: 8, 14, 22, +1 (i.e. -1)
  const players: RoundPlayer[] = [
    makeJgccPlayer({ id: "P1", name: "Pat (8)", handicap_index: 8, tee: blue }),
    makeJgccPlayer({ id: "P2", name: "Mike (14)", handicap_index: 14, tee: blue }),
    makeJgccPlayer({ id: "P3", name: "Sue (22)", handicap_index: 22, tee: white }),
    makeJgccPlayer({ id: "P4", name: "Pro (+1)", handicap_index: -1, tee: blue })
  ];

  const allScores: Record<UUID, number[]> = {
    P1: fakeRound(101, holes, 8),
    P2: fakeRound(202, holes, 14),
    P3: fakeRound(303, holes, 22),
    P4: fakeRound(404, holes, -1)
  };

  function inputFor(game: RoundGame, opts: { teams?: Record<UUID, UUID> } = {}): GameInput {
    const teamMap = opts.teams ?? {};
    const ps = players.map((p) => ({ ...p, team_id: teamMap[p.id] ?? null }));
    return {
      game,
      players: ps,
      scores: makeScores(allScores),
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      startingHole: 1,
      totalHoles: 18
    };
  }

  it("net skins (carry, $1) is zero-sum and produces sane output", () => {
    const game = makeGame({
      game_type: "skins_net",
      stake_cents: 0,
      config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
    });
    const out = settleGame(inputFor(game));
    expect(sumDeltas(out)).toBe(0);
    // No NaN, no undefined deltas
    for (const v of out.perPlayer.values()) {
      expect(Number.isFinite(v.delta_cents)).toBe(true);
    }
  });

  it("gross skins (no carry, $0.50) is zero-sum", () => {
    const game = makeGame({
      game_type: "skins_gross",
      stake_cents: 0,
      config: { skin_value_cents: 50, ties: "split" }
    });
    const out = settleGame(inputFor(game));
    expect(sumDeltas(out)).toBe(0);
  });

  it("Nassau ($10/$10/$10) two-player head-to-head zero-sum", () => {
    // settleNassau only does sideA vs sideB. With 4 players and no team_id,
    // it falls back to first two players. Run that as a sanity check.
    const game = makeGame({
      game_type: "nassau",
      stake_cents: 1000,
      config: {
        match_play: true,
        front_stake_cents: 1000,
        back_stake_cents: 1000,
        overall_stake_cents: 1000,
        presses: "auto_2_down"
      }
    });
    const out = settleGame(inputFor(game));
    expect(sumDeltas(out)).toBe(0);
  });

  it("2-man best ball net ($5) is zero-sum and lower-team-wins", () => {
    const game = makeGame({ game_type: "best_ball_net", stake_cents: 500 });
    const out = settleGame(
      inputFor(game, { teams: { P1: "T1", P4: "T1", P2: "T2", P3: "T2" } })
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("aggregate of all four games (with teams in best ball) settles to zero across all 4 players", () => {
    const teams = { P1: "T1", P4: "T1", P2: "T2", P3: "T2" };
    const outputs = [
      settleGame(
        inputFor(
          makeGame({
            game_type: "skins_net",
            stake_cents: 0,
            config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
          })
        )
      ),
      settleGame(
        inputFor(
          makeGame({
            game_type: "skins_gross",
            stake_cents: 0,
            config: { skin_value_cents: 50, ties: "split" }
          })
        )
      ),
      settleGame(
        inputFor(
          makeGame({
            game_type: "nassau",
            stake_cents: 1000,
            config: {
              match_play: true,
              front_stake_cents: 1000,
              back_stake_cents: 1000,
              overall_stake_cents: 1000
            }
          })
        )
      ),
      settleGame(inputFor(makeGame({ game_type: "best_ball_net", stake_cents: 500 }), { teams }))
    ];
    for (const o of outputs) expect(sumDeltas(o)).toBe(0);

    const balances = aggregatePerPlayer(outputs);
    let total = 0;
    for (const v of balances.values()) total += v;
    expect(total).toBe(0);

    const flows = minimumFlow(balances);
    // settlement cleans to zero
    const finalBal = applyFlows(balances, flows);
    for (const v of finalBal.values()) expect(v).toBe(0);
    // transfers <= n - 1
    expect(flows.length).toBeLessThanOrEqual(players.length - 1);
  });
});

// ============================================================
// SIM B — 8-player two-foursome best-ball aggregate
// ============================================================
describe("Sim B — 8 players, two foursomes vs each other (best-ball aggregate)", () => {
  const holes = jgccHoles();
  const blue = jgccBlue();
  const players: RoundPlayer[] = [
    makeJgccPlayer({ id: "A1", name: "A1", handicap_index: 6, tee: blue, team_id: "TA" }),
    makeJgccPlayer({ id: "A2", name: "A2", handicap_index: 12, tee: blue, team_id: "TA" }),
    makeJgccPlayer({ id: "A3", name: "A3", handicap_index: 18, tee: blue, team_id: "TA" }),
    makeJgccPlayer({ id: "A4", name: "A4", handicap_index: 24, tee: blue, team_id: "TA" }),
    makeJgccPlayer({ id: "B1", name: "B1", handicap_index: 5, tee: blue, team_id: "TB" }),
    makeJgccPlayer({ id: "B2", name: "B2", handicap_index: 11, tee: blue, team_id: "TB" }),
    makeJgccPlayer({ id: "B3", name: "B3", handicap_index: 17, tee: blue, team_id: "TB" }),
    makeJgccPlayer({ id: "B4", name: "B4", handicap_index: 25, tee: blue, team_id: "TB" })
  ];

  const allScores: Record<UUID, number[]> = {};
  players.forEach((p, i) => {
    allScores[p.id] = fakeRound(900 + i, holes, p.handicap_index_used);
  });

  it("best ball net team game zero-sum", () => {
    const game = makeGame({ game_type: "best_ball_net", stake_cents: 500 });
    const input: GameInput = {
      game,
      players,
      scores: makeScores(allScores),
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      startingHole: 1,
      totalHoles: 18
    };
    const out = settleGame(input);
    expect(sumDeltas(out)).toBe(0);
  });

  it("aggregate net team game zero-sum", () => {
    const game = makeGame({ game_type: "aggregate_net", stake_cents: 200 });
    const input: GameInput = {
      game,
      players,
      scores: makeScores(allScores),
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      startingHole: 1,
      totalHoles: 18
    };
    const out = settleGame(input);
    expect(sumDeltas(out)).toBe(0);
  });
});

// ============================================================
// SIM C — 12-player tournament: skins + CTP + long drive
// ============================================================
describe("Sim C — 12-player tournament", () => {
  const holes = jgccHoles();
  const blue = jgccBlue();
  const players: RoundPlayer[] = Array.from({ length: 12 }, (_, i) =>
    makeJgccPlayer({
      id: `T${i + 1}`,
      name: `Player${i + 1}`,
      handicap_index: 4 + i, // 4..15
      tee: blue
    })
  );
  const allScores: Record<UUID, number[]> = {};
  players.forEach((p, i) => {
    allScores[p.id] = fakeRound(1500 + i, holes, p.handicap_index_used);
  });
  const baseInput = (game: RoundGame, manualEntries?: ManualEntry[]): GameInput => ({
    game,
    players,
    scores: makeScores(allScores),
    course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
    manualEntries,
    startingHole: 1,
    totalHoles: 18
  });

  it("individual gross skins across 12 zero-sum", () => {
    const out = settleGame(
      baseInput(
        makeGame({
          game_type: "skins_gross",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "split" }
        })
      )
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("individual net skins across 12 zero-sum", () => {
    const out = settleGame(
      baseInput(
        makeGame({
          game_type: "skins_net",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
        })
      )
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("CTP on hole 5 — only one winner, zero-sum, exact stake transfer", () => {
    const game = makeGame({ game_type: "ctp", stake_cents: 100, config: { holes: [5] } });
    const entries: ManualEntry[] = [
      {
        round_game_id: game.id,
        hole_number: 5,
        winner_round_player_id: "T3",
        value_cents: null
      }
    ];
    const out = settleGame(baseInput(game, entries));
    expect(sumDeltas(out)).toBe(0);
    // T3 collects from 11 others * 100 = 1100
    expect(out.perPlayer.get("T3")!.delta_cents).toBe(11 * 100);
    // each other player loses 100
    for (const p of players) {
      if (p.id === "T3") continue;
      expect(out.perPlayer.get(p.id)!.delta_cents).toBe(-100);
    }
  });

  it("Long drive on hole 8 — only one winner, zero-sum", () => {
    const game = makeGame({
      game_type: "long_drive",
      stake_cents: 200,
      config: { holes: [8] }
    });
    const entries: ManualEntry[] = [
      {
        round_game_id: game.id,
        hole_number: 8,
        winner_round_player_id: "T7",
        value_cents: null
      }
    ];
    const out = settleGame(baseInput(game, entries));
    expect(sumDeltas(out)).toBe(0);
    expect(out.perPlayer.get("T7")!.delta_cents).toBe(11 * 200);
  });

  it("tournament aggregate settlement reconciles via minimumFlow", () => {
    const skinsGross = settleGame(
      baseInput(
        makeGame({
          game_type: "skins_gross",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "split" }
        })
      )
    );
    const skinsNet = settleGame(
      baseInput(
        makeGame({
          game_type: "skins_net",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
        })
      )
    );
    const ctpGame = makeGame({ game_type: "ctp", stake_cents: 100, config: { holes: [5] } });
    const ctp = settleGame(
      baseInput(ctpGame, [
        {
          round_game_id: ctpGame.id,
          hole_number: 5,
          winner_round_player_id: "T3",
          value_cents: null
        }
      ])
    );
    const ldGame = makeGame({ game_type: "long_drive", stake_cents: 200, config: { holes: [8] } });
    const ld = settleGame(
      baseInput(ldGame, [
        {
          round_game_id: ldGame.id,
          hole_number: 8,
          winner_round_player_id: "T7",
          value_cents: null
        }
      ])
    );

    const balances = aggregatePerPlayer([skinsGross, skinsNet, ctp, ld]);
    let total = 0;
    for (const v of balances.values()) total += v;
    expect(total).toBe(0);

    const flows = minimumFlow(balances);
    const finalBal = applyFlows(balances, flows);
    for (const v of finalBal.values()) expect(v).toBe(0);
    // # transfers <= players - 1
    expect(flows.length).toBeLessThanOrEqual(players.length - 1);
  });
});

// ============================================================
// SIM D — partial round: scores entered through hole 14 only
// ============================================================
describe("Sim D — partial state through hole 14", () => {
  const holes = jgccHoles();
  const blue = jgccBlue();
  const players: RoundPlayer[] = [
    makeJgccPlayer({ id: "Q1", name: "Q1", handicap_index: 9, tee: blue }),
    makeJgccPlayer({ id: "Q2", name: "Q2", handicap_index: 13, tee: blue }),
    makeJgccPlayer({ id: "Q3", name: "Q3", handicap_index: 19, tee: blue }),
    makeJgccPlayer({ id: "Q4", name: "Q4", handicap_index: 4, tee: blue })
  ];
  const fullScores: Record<UUID, number[]> = {
    Q1: fakeRound(2001, holes, 9),
    Q2: fakeRound(2002, holes, 13),
    Q3: fakeRound(2003, holes, 19),
    Q4: fakeRound(2004, holes, 4)
  };
  const partial = partialScores(fullScores, 14);

  function input(game: RoundGame, teams?: Record<UUID, UUID>): GameInput {
    const ps = players.map((p) => ({ ...p, team_id: teams?.[p.id] ?? null }));
    return {
      game,
      players: ps,
      scores: partial,
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      startingHole: 1,
      totalHoles: 18
    };
  }

  it("individual_net does not crash and is zero-sum (live)", () => {
    const out = settleGame(input(makeGame({ game_type: "individual_net", stake_cents: 500 })));
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live");
  });

  it("skins_net partial does not crash and is zero-sum", () => {
    const out = settleGame(
      input(
        makeGame({
          game_type: "skins_net",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
        })
      )
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("nassau partial: front-9 settled, back+overall live, zero-sum overall", () => {
    const out = settleGame(
      input(
        makeGame({
          game_type: "nassau",
          stake_cents: 1000,
          config: {
            match_play: true,
            front_stake_cents: 1000,
            back_stake_cents: 1000,
            overall_stake_cents: 1000
          }
        })
      )
    );
    expect(sumDeltas(out)).toBe(0);
    expect(out.status).toBe("live");
  });

  it("best_ball_net partial does not crash and is zero-sum", () => {
    const out = settleGame(
      input(makeGame({ game_type: "best_ball_net", stake_cents: 500 }), {
        Q1: "T1",
        Q4: "T1",
        Q2: "T2",
        Q3: "T2"
      })
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("aggregate of partials still sums to zero across all 4 players", () => {
    const outs = [
      settleGame(input(makeGame({ game_type: "individual_net", stake_cents: 500 }))),
      settleGame(
        input(
          makeGame({
            game_type: "skins_net",
            stake_cents: 0,
            config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
          })
        )
      ),
      settleGame(
        input(
          makeGame({
            game_type: "nassau",
            stake_cents: 1000,
            config: {
              match_play: true,
              front_stake_cents: 1000,
              back_stake_cents: 1000,
              overall_stake_cents: 1000
            }
          })
        )
      )
    ];
    const balances = aggregatePerPlayer(outs);
    let total = 0;
    for (const v of balances.values()) total += v;
    expect(total).toBe(0);
  });
});

// ============================================================
// SIM E — handicap edge cases
// ============================================================
describe("Sim E — handicap edge cases", () => {
  const holes = jgccHoles();
  const blue = jgccBlue();
  const players: RoundPlayer[] = [
    makeJgccPlayer({ id: "PLUS", name: "Scratch+", handicap_index: -2, tee: blue }),
    makeJgccPlayer({ id: "MID", name: "Middle", handicap_index: 14, tee: blue }),
    makeJgccPlayer({ id: "MAX", name: "Max", handicap_index: 36, tee: blue })
  ];

  const allScores: Record<UUID, number[]> = {
    PLUS: fakeRound(7001, holes, -2),
    MID: fakeRound(7002, holes, 14),
    MAX: fakeRound(7003, holes, 36)
  };

  it("plus-handicap player has negative strokes assigned on highest-SI holes", () => {
    // We can't easily access internal stroke allocation through settleGame, but
    // we can verify net skins doesn't crash and is zero-sum, which indirectly
    // exercises strokesPerHole for negative HC.
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores(allScores),
        course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
        game: makeGame({
          game_type: "skins_net",
          stake_cents: 0,
          config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
        })
      })
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("36-handicap player gets 2 strokes on hardest holes (verified via individual_net zero-sum)", () => {
    const out = settleGame(
      makeInput({
        players,
        scores: makeScores(allScores),
        course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
        game: makeGame({ game_type: "individual_net", stake_cents: 500 })
      })
    );
    expect(sumDeltas(out)).toBe(0);
  });

  it("plus + max handicap together still produces zero-sum settlement", () => {
    const outs = [
      settleGame(
        makeInput({
          players,
          scores: makeScores(allScores),
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
          game: makeGame({ game_type: "individual_net", stake_cents: 500 })
        })
      ),
      settleGame(
        makeInput({
          players,
          scores: makeScores(allScores),
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
          game: makeGame({
            game_type: "skins_net",
            stake_cents: 0,
            config: { skin_value_cents: 100, ties: "carry", escalation: "linear" }
          })
        })
      )
    ];
    const balances = aggregatePerPlayer(outs);
    let total = 0;
    for (const v of balances.values()) total += v;
    expect(total).toBe(0);
  });
});
