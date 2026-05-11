/**
 * Tests for the event settlement engine (Phase 3 of MULTI_GROUP_DESIGN.md).
 *
 * Covers:
 *   - buildEventFieldStandings: aggregation across foursomes, sort
 *     order, multi-round players (trip case), thru-hole rollup,
 *     finalized-rounds count
 *   - settleEventGame: field-wide skins, field-wide individual stroke,
 *     rejection of match-play / team / Nassau types
 *   - buildEventBundle: per-player money aggregation across event
 *     games
 */
import { describe, it, expect } from "vitest";
import {
  buildEventFieldStandings,
  settleEventGame,
  buildEventBundle,
  type EventBundleInput,
  type EventRoundShape
} from "@/lib/events/settle";
import { makeHoles, makePlayer } from "./fixtures";
import type { EventGame, GolfEvent, RoundPlayer, Score } from "@/lib/types";

// JGCC par layout (par 72)
const JGCC_PARS = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5];
const JGCC_HOLES = makeHoles(JGCC_PARS);

function makeEvent(overrides: Partial<GolfEvent> = {}): GolfEvent {
  return {
    id: "ev-1",
    group_id: "grp-1",
    name: "Member-Guest 2026",
    kind: "tournament",
    starts_on: "2026-05-01",
    ends_on: null,
    spectator_token: "spec-token-1",
    commissioner_profile_id: "pro-1",
    deleted_at: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides
  };
}

function makeRoundShape(
  id: string,
  overrides: Partial<EventRoundShape> = {}
): EventRoundShape {
  return {
    id,
    date: "2026-05-01",
    status: "live",
    holes: 18,
    course_id: "c-jgcc",
    course_name: "JGCC",
    course_holes: JGCC_HOLES,
    ...overrides
  };
}

function rpWithRound(
  id: string,
  name: string,
  round_id: string,
  player_id: string,
  playing_handicap = 0,
  team_id: string | null = null
): RoundPlayer & { round_id: string } {
  return {
    ...makePlayer({ id, name, playing_handicap, team_id }),
    player_id,
    round_id
  } as any;
}

describe("buildEventFieldStandings: single-round event (tournament with 1 foursome)", () => {
  const event = makeEvent();
  const round = makeRoundShape("r1");
  const rps = [
    rpWithRound("rp-a", "Pat", "r1", "p-pat"),
    rpWithRound("rp-b", "Ben", "r1", "p-ben"),
    rpWithRound("rp-c", "Mit", "r1", "p-mit"),
    rpWithRound("rp-d", "Kyl", "r1", "p-kyl")
  ];

  it("returns 4 players sorted by net asc with thru counts", () => {
    // Pat shoots 70 (-2), Ben 75 (+3), Mit 73 (+1), Kyl 80 (+8)
    // All par except Pat's 2 birdies (holes 1+2), Ben's 3 bogeys
    // (holes 1,2,3), Mit's 1 bogey (hole 1), Kyl's 8 bogeys (1-8).
    const scoresFor = (rp: string, total: number): Score[] => {
      const par = JGCC_PARS.reduce((a, b) => a + b, 0);
      const diff = total - par;
      const grosses = [...JGCC_PARS];
      if (diff > 0) for (let i = 0; i < diff; i++) grosses[i % 18] += 1;
      if (diff < 0) for (let i = 0; i < -diff; i++) grosses[i % 18] -= 1;
      return grosses.map((g, i) => ({
        round_player_id: rp,
        hole_number: i + 1,
        gross: g
      }));
    };
    const scores: Score[] = [
      ...scoresFor("rp-a", 70),
      ...scoresFor("rp-b", 75),
      ...scoresFor("rp-c", 73),
      ...scoresFor("rp-d", 80)
    ];
    const input: EventBundleInput = {
      event,
      rounds: [round],
      rps,
      scores,
      event_games: []
    };
    const out = buildEventFieldStandings(input);
    expect(out.players).toHaveLength(4);
    // Pat (70 net) should lead since playing_handicap=0 → net == gross
    expect(out.players[0].player_id).toBe("p-pat");
    expect(out.players[0].total_gross).toBe(70);
    expect(out.players[0].total_net).toBe(70);
    expect(out.players[0].thru_holes_total).toBe(18);
    expect(out.players[0].vs_par_gross).toBe(-2);
    // Mit second (73), Ben third (75), Kyl fourth (80)
    expect(out.players.map((p) => p.player_id)).toEqual([
      "p-pat",
      "p-mit",
      "p-ben",
      "p-kyl"
    ]);
  });

  it("foursome status shows 'thru X' from the max scored hole", () => {
    // Only holes 1-9 scored
    const scores: Score[] = rps.flatMap((rp) =>
      Array.from({ length: 9 }, (_, i) => ({
        round_player_id: rp.id,
        hole_number: i + 1,
        gross: 4
      }))
    );
    const input: EventBundleInput = {
      event,
      rounds: [round],
      rps,
      scores,
      event_games: []
    };
    const out = buildEventFieldStandings(input);
    expect(out.foursomes).toHaveLength(1);
    expect(out.foursomes[0].thru_holes).toBe(9);
    expect(out.foursomes[0].total_holes).toBe(18);
    expect(out.foursomes[0].player_count).toBe(4);
  });

  it("empty event (no scores) returns players with 0 thru + 0 totals", () => {
    const input: EventBundleInput = {
      event,
      rounds: [round],
      rps,
      scores: [],
      event_games: []
    };
    const out = buildEventFieldStandings(input);
    expect(out.players).toHaveLength(4);
    for (const p of out.players) {
      expect(p.thru_holes_total).toBe(0);
      expect(p.total_gross).toBe(0);
      expect(p.par_total_played).toBe(0);
    }
  });
});

describe("buildEventFieldStandings: multi-foursome tournament (16 players, 4 rounds)", () => {
  const event = makeEvent({
    id: "ev-mg",
    name: "Member-Guest 2026",
    kind: "tournament"
  });
  const rounds = [
    makeRoundShape("r1"),
    makeRoundShape("r2"),
    makeRoundShape("r3"),
    makeRoundShape("r4")
  ];
  // 16 players, 4 per round
  const rps: Array<RoundPlayer & { round_id: string }> = [];
  for (let r = 0; r < 4; r++) {
    for (let p = 0; p < 4; p++) {
      const id = `rp-r${r + 1}-p${p + 1}`;
      const pid = `p-r${r + 1}-p${p + 1}`;
      rps.push(rpWithRound(id, `R${r + 1}P${p + 1}`, `r${r + 1}`, pid));
    }
  }

  it("16-player field aggregates correctly + sorted by net", () => {
    // Every player shoots even par.
    const scores: Score[] = rps.flatMap((rp) =>
      JGCC_PARS.map((p, i) => ({
        round_player_id: rp.id,
        hole_number: i + 1,
        gross: p
      }))
    );
    const out = buildEventFieldStandings({
      event,
      rounds,
      rps,
      scores,
      event_games: []
    });
    expect(out.players).toHaveLength(16);
    // All tied at even par; just confirm shape.
    expect(out.players.every((p) => p.total_gross === 72)).toBe(true);
    expect(out.players.every((p) => p.thru_holes_total === 18)).toBe(true);
    expect(out.foursomes).toHaveLength(4);
    expect(out.foursomes.every((f) => f.player_count === 4)).toBe(true);
  });

  it("mixed completion: some foursomes finalized, some live", () => {
    rounds[0].status = "finalized";
    rounds[1].status = "finalized";
    rounds[2].status = "live";
    rounds[3].status = "live";
    const scores: Score[] = rps.flatMap((rp) =>
      JGCC_PARS.map((p, i) => ({
        round_player_id: rp.id,
        hole_number: i + 1,
        gross: p
      }))
    );
    const out = buildEventFieldStandings({
      event,
      rounds,
      rps,
      scores,
      event_games: []
    });
    // 8 players in finalized rounds, 8 in live rounds
    const finalizedCount = out.players.filter(
      (p) => p.rounds_finalized === 1
    ).length;
    expect(finalizedCount).toBe(8);
  });
});

describe("buildEventFieldStandings: multi-day trip (same player in multiple rounds)", () => {
  const event = makeEvent({ kind: "trip" });
  const day1 = makeRoundShape("d1", {
    date: "2026-05-01",
    status: "finalized"
  });
  const day2 = makeRoundShape("d2", {
    date: "2026-05-02",
    status: "finalized"
  });
  const day3 = makeRoundShape("d3", {
    date: "2026-05-03",
    status: "live"
  });

  // Same 4 players across 3 days.
  const playerIds = ["p-pat", "p-ben", "p-mit", "p-kyl"];
  const names = ["Pat", "Ben", "Mit", "Kyl"];
  const rps: Array<RoundPlayer & { round_id: string }> = [];
  for (const day of [day1, day2, day3]) {
    playerIds.forEach((pid, i) => {
      const rpId = `rp-${day.id}-${pid}`;
      rps.push(rpWithRound(rpId, names[i], day.id, pid));
    });
  }

  it("aggregates one player's 3 rounds into a single field row", () => {
    // Pat: shoots 70 / 72 / 74 across 3 days = 216 total over 54 holes
    // Ben: shoots 75 / 75 / 75 = 225 total
    // Others all par every hole = 216 each
    const scoresFor = (rp: string, total: number): Score[] => {
      const par = JGCC_PARS.reduce((a, b) => a + b, 0);
      const diff = total - par;
      const grosses = [...JGCC_PARS];
      if (diff > 0) for (let i = 0; i < diff; i++) grosses[i % 18] += 1;
      if (diff < 0) for (let i = 0; i < -diff; i++) grosses[i % 18] -= 1;
      return grosses.map((g, i) => ({
        round_player_id: rp,
        hole_number: i + 1,
        gross: g
      }));
    };
    const scores: Score[] = [
      ...scoresFor("rp-d1-p-pat", 70),
      ...scoresFor("rp-d1-p-ben", 75),
      ...scoresFor("rp-d1-p-mit", 72),
      ...scoresFor("rp-d1-p-kyl", 72),
      ...scoresFor("rp-d2-p-pat", 72),
      ...scoresFor("rp-d2-p-ben", 75),
      ...scoresFor("rp-d2-p-mit", 72),
      ...scoresFor("rp-d2-p-kyl", 72),
      ...scoresFor("rp-d3-p-pat", 74),
      ...scoresFor("rp-d3-p-ben", 75),
      ...scoresFor("rp-d3-p-mit", 72),
      ...scoresFor("rp-d3-p-kyl", 72)
    ];
    const out = buildEventFieldStandings({
      event,
      rounds: [day1, day2, day3],
      rps,
      scores,
      event_games: []
    });
    // 4 players (NOT 12 — one row per player_id, not per rp_id)
    expect(out.players).toHaveLength(4);
    const pat = out.players.find((p) => p.player_id === "p-pat");
    expect(pat).toBeDefined();
    expect(pat!.rounds_rostered).toBe(3);
    expect(pat!.rounds_finalized).toBe(2); // d1 + d2 finalized, d3 live
    expect(pat!.thru_holes_total).toBe(54); // 18 × 3 days
    expect(pat!.total_gross).toBe(216);
    expect(pat!.par_total_played).toBe(216); // 72 × 3
    expect(pat!.vs_par_gross).toBe(0);
    // Mit + Kyl total 216 each. Ben 225.
    expect(
      out.players.find((p) => p.player_id === "p-ben")?.total_gross
    ).toBe(225);
  });
});

describe("settleEventGame: field-wide skins", () => {
  const event = makeEvent();
  const round = makeRoundShape("r1");
  const rps = [
    rpWithRound("rp-a", "Pat", "r1", "p-pat"),
    rpWithRound("rp-b", "Ben", "r1", "p-ben"),
    rpWithRound("rp-c", "Mit", "r1", "p-mit"),
    rpWithRound("rp-d", "Kyl", "r1", "p-kyl")
  ];

  it("field skins gross — engine processes the field via per-round path", () => {
    // Pat birdies hole 1 (3 vs par 4); others par. Pat wins skin 1.
    const scores: Score[] = rps.flatMap((rp, i) =>
      JGCC_PARS.map((p, h) => ({
        round_player_id: rp.id,
        hole_number: h + 1,
        gross: rp.id === "rp-a" && h === 0 ? p - 1 : p
      }))
    );
    const game: EventGame = {
      id: "evg-1",
      event_id: event.id,
      game_type: "skins_gross",
      name: "Field skins",
      stake_cents: 500,
      allowance_pct: 100,
      config: {},
      display_order: 0,
      created_at: "2026-05-01T00:00:00Z"
    };
    const out = settleEventGame(game, {
      event,
      rounds: [round],
      rps,
      scores,
      event_games: [game]
    });
    expect(out.perPlayer.size).toBeGreaterThan(0);
    // Zero-sum
    let sum = 0;
    for (const [, v] of out.perPlayer) sum += v.delta_cents;
    expect(sum).toBe(0);
    // Pat should be net positive (he won at least one skin)
    expect((out.perPlayer.get("rp-a")?.delta_cents ?? 0)).toBeGreaterThan(0);
  });
});

describe("settleEventGame: rejects unsupported game types (Nassau / team / match-play)", () => {
  const event = makeEvent();
  const round = makeRoundShape("r1");
  const rps = [
    rpWithRound("rp-a", "Pat", "r1", "p-pat"),
    rpWithRound("rp-b", "Ben", "r1", "p-ben")
  ];
  const input: EventBundleInput = {
    event,
    rounds: [round],
    rps,
    scores: [],
    event_games: []
  };

  it.each([
    "nassau",
    "six_six_six",
    "best_ball_gross",
    "best_ball_net",
    "aggregate_gross",
    "aggregate_net",
    "scramble_gross",
    "scramble_net",
    "match_play"
  ] as const)("%s returns empty output (per-foursome only)", (gt) => {
    const game: EventGame = {
      id: "evg-bad",
      event_id: event.id,
      game_type: gt as any,
      name: "Should not settle event-wide",
      stake_cents: 1000,
      allowance_pct: 100,
      config: {},
      display_order: 0,
      created_at: "2026-05-01T00:00:00Z"
    };
    const out = settleEventGame(game, input);
    expect(out.perPlayer.size).toBe(0);
  });
});

describe("buildEventFieldStandings: projected finishes + play status", () => {
  const event = makeEvent();
  const round = makeRoundShape("r1");
  const rps = [
    rpWithRound("rp-a", "Pat", "r1", "p-pat"),
    rpWithRound("rp-b", "Ben", "r1", "p-ben"),
    rpWithRound("rp-c", "Mit", "r1", "p-mit")
  ];

  it("not_started status when zero holes scored", () => {
    const out = buildEventFieldStandings({
      event,
      rounds: [round],
      rps,
      scores: [],
      event_games: []
    });
    // not_started players sink to the bottom — but they still appear.
    for (const p of out.players) {
      expect(p.play_status).toBe("not_started");
      expect(p.thru_holes_total).toBe(0);
      expect(p.thru_holes_expected).toBe(18);
      expect(p.projected_gross_if_pars).toBe(72); // par 72 floor
    }
  });

  it("live status when partial — and projection assumes pars for remaining", () => {
    // Pat scored holes 1-9 (front 9): birdied hole 1, par rest → gross 35.
    // Front-9 par = 4+4+5+3+4+4+5+3+4 = 36. Pat shot 35 = -1.
    // Projection: total_gross 35 + remaining_par 36 = 71. floor (best case).
    const patScores: Score[] = JGCC_PARS.slice(0, 9).map((p, i) => ({
      round_player_id: "rp-a",
      hole_number: i + 1,
      gross: i === 0 ? p - 1 : p
    }));
    const out = buildEventFieldStandings({
      event,
      rounds: [round],
      rps,
      scores: patScores,
      event_games: []
    });
    const pat = out.players.find((p) => p.player_id === "p-pat")!;
    expect(pat.play_status).toBe("live");
    expect(pat.thru_holes_total).toBe(9);
    expect(pat.total_gross).toBe(35);
    expect(pat.projected_gross_if_pars).toBe(71);
    // Ben + Mit not_started
    expect(
      out.players.find((p) => p.player_id === "p-ben")?.play_status
    ).toBe("not_started");
  });

  it("finished status when every scheduled hole is scored", () => {
    // Pat scores all 18 — par every hole.
    const patScores: Score[] = JGCC_PARS.map((p, i) => ({
      round_player_id: "rp-a",
      hole_number: i + 1,
      gross: p
    }));
    const out = buildEventFieldStandings({
      event,
      rounds: [round],
      rps,
      scores: patScores,
      event_games: []
    });
    const pat = out.players.find((p) => p.player_id === "p-pat")!;
    expect(pat.play_status).toBe("finished");
    expect(pat.thru_holes_total).toBe(18);
    expect(pat.thru_holes_expected).toBe(18);
    // Projection equals total when nothing's left to play
    expect(pat.projected_gross_if_pars).toBe(pat.total_gross);
  });

  it("sort: started players appear before not_started, sinking inactive entries to the bottom", () => {
    // Mit scored 9 holes at par (=36). Pat & Ben not started.
    const mitScores: Score[] = JGCC_PARS.slice(0, 9).map((p, i) => ({
      round_player_id: "rp-c",
      hole_number: i + 1,
      gross: p
    }));
    const out = buildEventFieldStandings({
      event,
      rounds: [round],
      rps,
      scores: mitScores,
      event_games: []
    });
    expect(out.players[0].player_id).toBe("p-mit");
    expect(out.players[0].play_status).toBe("live");
    expect(out.players.slice(1).every((p) => p.play_status === "not_started")).toBe(
      true
    );
  });

  it("multi-day trip: thru_holes_expected sums across rounds, projection respects it", () => {
    // 3 rounds for one player, each 18 holes. Pat scored all 18 on day 1
    // (gross 72), nothing on days 2-3.
    const day1 = makeRoundShape("d1", { date: "2026-05-01", status: "finalized" });
    const day2 = makeRoundShape("d2", { date: "2026-05-02", status: "draft" });
    const day3 = makeRoundShape("d3", { date: "2026-05-03", status: "draft" });
    const tripRps = [
      rpWithRound("rp-d1-pat", "Pat", "d1", "p-pat"),
      rpWithRound("rp-d2-pat", "Pat", "d2", "p-pat"),
      rpWithRound("rp-d3-pat", "Pat", "d3", "p-pat")
    ];
    const patDay1Scores: Score[] = JGCC_PARS.map((p, i) => ({
      round_player_id: "rp-d1-pat",
      hole_number: i + 1,
      gross: p
    }));
    const out = buildEventFieldStandings({
      event: makeEvent({ kind: "trip" }),
      rounds: [day1, day2, day3],
      rps: tripRps,
      scores: patDay1Scores,
      event_games: []
    });
    const pat = out.players.find((p) => p.player_id === "p-pat")!;
    expect(pat.thru_holes_total).toBe(18);
    expect(pat.thru_holes_expected).toBe(54);
    expect(pat.total_gross).toBe(72);
    // Projection: 72 (gross so far) + 144 (par on 36 remaining holes) = 216.
    // Par of day 2 + day 3 = 72 * 2 = 144.
    expect(pat.projected_gross_if_pars).toBe(216);
    // Live, not finished — still has 36 holes to play.
    expect(pat.play_status).toBe("live");
  });
});

describe("buildEventBundle: per-player money aggregates across event games", () => {
  const event = makeEvent();
  const round = makeRoundShape("r1");
  const rps = [
    rpWithRound("rp-a", "Pat", "r1", "p-pat"),
    rpWithRound("rp-b", "Ben", "r1", "p-ben"),
    rpWithRound("rp-c", "Mit", "r1", "p-mit"),
    rpWithRound("rp-d", "Kyl", "r1", "p-kyl")
  ];

  it("returns standings + per-game outputs + per_player_event_money map keyed on player_id", () => {
    // Pat birdies hole 1 → wins gross skin. Otherwise all par.
    const scores: Score[] = rps.flatMap((rp) =>
      JGCC_PARS.map((p, h) => ({
        round_player_id: rp.id,
        hole_number: h + 1,
        gross: rp.id === "rp-a" && h === 0 ? p - 1 : p
      }))
    );
    const event_games: EventGame[] = [
      {
        id: "evg-1",
        event_id: event.id,
        game_type: "skins_gross",
        name: "Field skins",
        stake_cents: 500,
        allowance_pct: 100,
        config: {},
        display_order: 0,
        created_at: "2026-05-01T00:00:00Z"
      }
    ];
    const bundle = buildEventBundle({
      event,
      rounds: [round],
      rps,
      scores,
      event_games
    });
    expect(bundle.standings.players).toHaveLength(4);
    expect(bundle.game_outputs).toHaveLength(1);
    // Per-player money is keyed on player_id (not rp_id)
    const patMoney = bundle.per_player_event_money.get("p-pat") ?? 0;
    expect(patMoney).toBeGreaterThan(0);
    // Zero-sum
    const sum = [...bundle.per_player_event_money.values()].reduce(
      (s, v) => s + v,
      0
    );
    expect(sum).toBe(0);
  });
});
