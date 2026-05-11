/**
 * Tests for the live match-state helper that answers
 *   "What's happening in the match right now?"
 *
 * Covers Nassau (3 segments / 1 segment 9-hole), 6-6-6 (3 rotating
 * pairs), Best Ball / Aggregate / Scramble team formats, and the
 * dormie/closed-out detection.
 */
import { describe, it, expect } from "vitest";
import {
  buildLiveMatchState,
  fmtSegmentStatus,
  fmtAutoPressStatus
} from "@/lib/games/live-state";
import {
  makeGame,
  makeHoles,
  makeInput,
  makePlayer,
  makeScores
} from "./fixtures";

const PARS = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5];

describe("buildLiveMatchState: Nassau", () => {
  const players = [
    makePlayer({ id: "rp-a", name: "Pat", team_id: "team-a" }),
    makePlayer({ id: "rp-b", name: "Mit", team_id: "team-b" })
  ];
  const holes = makeHoles(PARS);

  it("returns 3 segments on an 18-hole round (front / back / overall)", () => {
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          name: "Nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: makeScores({ "rp-a": [], "rp-b": [] }),
        course: { holes, par: 72 }
      })
    );
    expect(state).not.toBeNull();
    expect(state!.segments.map((s) => s.segment_label)).toEqual([
      "Nassau front",
      "Nassau back",
      "Nassau overall"
    ]);
    expect(state!.variant).toBe("nassau");
  });

  it("'not started' when zero holes scored", () => {
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [],
        course: { holes, par: 72 }
      })
    );
    expect(fmtSegmentStatus(state!.segments[0])).toBe("Not started");
  });

  it("match-play: Pat up 2 thru 6 on the front", () => {
    // Pat shoots par on every hole. Mit bogeys holes 1+3 → Pat up 2 thru 6.
    const patScores = [...PARS];
    const mitScores = PARS.map((p, i) => (i === 0 || i === 2 ? p + 1 : p));
    // Only first 6 holes are scored; rest null.
    const sliceTo6 = (arr: number[]) =>
      arr.map((g, i) => (i < 6 ? g : null)) as (number | null)[];
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [
          ...sliceTo6(patScores).map((g, i) => ({
            round_player_id: "rp-a",
            hole_number: i + 1,
            gross: g
          })),
          ...sliceTo6(mitScores).map((g, i) => ({
            round_player_id: "rp-b",
            hole_number: i + 1,
            gross: g
          }))
        ],
        course: { holes, par: 72 }
      })
    );
    const front = state!.segments.find((s) => s.segment_label === "Nassau front")!;
    expect(front.holes_played).toBe(6);
    expect(front.a_up).toBe(2);
    expect(fmtSegmentStatus(front)).toBe("Pat up 2 · thru 6");
  });

  it("detects dormie (lead equals remaining)", () => {
    // After 6 of 9 front holes: Pat up 3 with 3 to play → dormie.
    const patScores = [...PARS];
    const mitScores = PARS.map((p, i) => (i < 3 ? p + 1 : p));
    const sliceTo6 = (arr: number[]) =>
      arr.map((g, i) => (i < 6 ? g : null));
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [
          ...sliceTo6(patScores).map((g, i) => ({
            round_player_id: "rp-a",
            hole_number: i + 1,
            gross: g
          })),
          ...sliceTo6(mitScores).map((g, i) => ({
            round_player_id: "rp-b",
            hole_number: i + 1,
            gross: g
          }))
        ],
        course: { holes, par: 72 }
      })
    );
    const front = state!.segments.find((s) => s.segment_label === "Nassau front")!;
    expect(front.dormie_or_closed).toBe("dormie");
    expect(fmtSegmentStatus(front)).toBe("Pat dormie · 3 to play");
  });

  it("detects closed-out (lead exceeds remaining)", () => {
    // Pat up 4 thru 5 → 4 holes remaining → not closed out yet (4=4 is dormie).
    // Try Pat up 5 thru 5 → 4 remaining → closed out 5 & 4.
    const patScores = PARS.map((p) => p - 1); // birdies all
    const mitScores = [...PARS]; // pars all
    const sliceTo5 = (arr: number[]) =>
      arr.map((g, i) => (i < 5 ? g : null));
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [
          ...sliceTo5(patScores).map((g, i) => ({
            round_player_id: "rp-a",
            hole_number: i + 1,
            gross: g
          })),
          ...sliceTo5(mitScores).map((g, i) => ({
            round_player_id: "rp-b",
            hole_number: i + 1,
            gross: g
          }))
        ],
        course: { holes, par: 72 }
      })
    );
    const front = state!.segments.find((s) => s.segment_label === "Nassau front")!;
    expect(front.a_up).toBe(5);
    expect(front.dormie_or_closed).toBe("closed_out_by_a");
    expect(fmtSegmentStatus(front)).toBe("Pat closed out · 5 & 4");
  });

  it("9-hole round produces a single 'Nassau 9' segment", () => {
    const holes9 = makeHoles(PARS.slice(0, 9));
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [],
        course: { holes: holes9, par: 36 },
        totalHoles: 9
      })
    );
    expect(state!.segments).toHaveLength(1);
    expect(state!.segments[0].segment_label).toBe("Nassau 9");
  });
});

describe("buildLiveMatchState: 6-6-6", () => {
  const players = [
    makePlayer({ id: "rp-a", name: "Pat" }),
    makePlayer({ id: "rp-b", name: "Ben" }),
    makePlayer({ id: "rp-c", name: "Mit" }),
    makePlayer({ id: "rp-d", name: "Kyl" })
  ];
  const holes = makeHoles(PARS);

  it("3 segments with the default partner rotation labeled correctly", () => {
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "six_six_six",
          name: "6-6-6",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [],
        course: { holes, par: 72 }
      })
    );
    expect(state!.variant).toBe("six_six_six");
    expect(state!.segments).toHaveLength(3);
    expect(state!.segments[0].segment_label).toBe("Seg 1 (1-6)");
    expect(state!.segments[0].side_a.label).toBe("Pat + Ben");
    expect(state!.segments[0].side_b.label).toBe("Mit + Kyl");
    expect(state!.segments[1].side_a.label).toBe("Pat + Mit");
    expect(state!.segments[1].side_b.label).toBe("Ben + Kyl");
    expect(state!.segments[2].side_a.label).toBe("Pat + Kyl");
    expect(state!.segments[2].side_b.label).toBe("Ben + Mit");
  });

  it("partner rotation shows who's teamed in each segment after scores", () => {
    // Pat birdies all 6 holes of segment 1; everyone else pars.
    // Team A (Pat+Ben) min is 3 on each hole. Team B (Mit+Kyl) min is 4.
    // → Pat+Ben up 6 = closed out 6 & 0.
    // But that's mathematically all 6 holes won — closed out at hole 6 = "6 & 0"
    // which is unusual; the threshold is absLead > remaining and remaining is 0
    // at the end, so dormie_or_closed stays null.
    const patScores = PARS.slice(0, 6).map((p) => p - 1);
    const benScores = PARS.slice(0, 6).map((p) => p);
    const mitScores = PARS.slice(0, 6).map((p) => p);
    const kylScores = PARS.slice(0, 6).map((p) => p);
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "six_six_six",
          config: { net: false, match_play: true }
        }),
        players,
        scores: [
          ...patScores.map((g, i) => ({
            round_player_id: "rp-a",
            hole_number: i + 1,
            gross: g
          })),
          ...benScores.map((g, i) => ({
            round_player_id: "rp-b",
            hole_number: i + 1,
            gross: g
          })),
          ...mitScores.map((g, i) => ({
            round_player_id: "rp-c",
            hole_number: i + 1,
            gross: g
          })),
          ...kylScores.map((g, i) => ({
            round_player_id: "rp-d",
            hole_number: i + 1,
            gross: g
          }))
        ],
        course: { holes, par: 72 }
      })
    );
    const seg1 = state!.segments[0];
    expect(seg1.holes_played).toBe(6);
    expect(seg1.a_up).toBe(6); // Pat+Ben won every hole
    // Seg 2/3 not yet played:
    expect(state!.segments[1].holes_played).toBe(0);
    expect(state!.segments[2].holes_played).toBe(0);
  });
});

describe("buildLiveMatchState: team game (best ball / aggregate / scramble)", () => {
  const players = [
    makePlayer({ id: "rp-a1", name: "Pat", team_id: "team-a" }),
    makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
    makePlayer({ id: "rp-b1", name: "Mit", team_id: "team-b" }),
    makePlayer({ id: "rp-b2", name: "Kyl", team_id: "team-b" })
  ];
  const holes = makeHoles(PARS);

  it("best ball (stroke): aggregates team totals over played holes", () => {
    // Pat birdies hole 1; everyone else pars all 18.
    // Team A min on hole 1 = 3; Team B min on hole 1 = 4. After 1 hole:
    // a_total=3, b_total=4 → diff +1 in favor of A.
    const patScores = PARS.map((p, i) => (i === 0 ? p - 1 : p));
    const teamPars = [...PARS];
    const oneHole = (rp: string, arr: number[]) =>
      arr.map((g, i) => (i === 0 ? { round_player_id: rp, hole_number: i + 1, gross: g } : { round_player_id: rp, hole_number: i + 1, gross: null }));
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "best_ball_gross",
          name: "Best Ball (gross)",
          config: {}
        }),
        players,
        scores: [
          ...oneHole("rp-a1", patScores),
          ...oneHole("rp-a2", teamPars),
          ...oneHole("rp-b1", teamPars),
          ...oneHole("rp-b2", teamPars)
        ],
        course: { holes, par: 72 }
      })
    );
    expect(state!.variant).toBe("team_stroke");
    const seg = state!.segments[0];
    expect(seg.holes_played).toBe(1);
    expect(seg.a_total).toBe(3); // Pat's birdie
    expect(seg.b_total).toBe(4); // par
    expect(fmtSegmentStatus(seg)).toBe("Pat + Ben −1 · 1 played");
  });

  it("aggregate sums both players' scores per hole instead of taking min", () => {
    // On hole 1: Pat 4, Ben 5 → team A aggregate = 9. Mit 4, Kyl 4 → team B = 8.
    const scores = makeScores({
      "rp-a1": [4, ...Array(17).fill(null) as any[]],
      "rp-a2": [5, ...Array(17).fill(null) as any[]],
      "rp-b1": [4, ...Array(17).fill(null) as any[]],
      "rp-b2": [4, ...Array(17).fill(null) as any[]]
    });
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "aggregate_gross",
          name: "2-Man Aggregate",
          config: {}
        }),
        players,
        scores,
        course: { holes, par: 72 }
      })
    );
    const seg = state!.segments[0];
    expect(seg.a_total).toBe(9);
    expect(seg.b_total).toBe(8);
  });

  it("scramble: one entry per team is enough to settle the hole's match state", () => {
    // Only Pat (rp-a1) and Mit (rp-b1) entered scores; their partners are
    // null. Engine still computes team scores via min(entered).
    const scores = [
      { round_player_id: "rp-a1", hole_number: 1, gross: 3 },
      { round_player_id: "rp-b1", hole_number: 1, gross: 4 }
    ];
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "scramble_gross",
          name: "Scramble",
          config: {}
        }),
        players,
        scores,
        course: { holes, par: 72 }
      })
    );
    const seg = state!.segments[0];
    expect(seg.holes_played).toBe(1);
    expect(seg.a_total).toBe(3);
    expect(seg.b_total).toBe(4);
  });

  it("match_play=true variant: tracks holes won, ties, leads", () => {
    // Two 2v2 teams. Hole 1: A wins 3-4. Hole 2: B wins 4-5.
    // Match: A 1, B 1, tied.
    const scores = makeScores({
      "rp-a1": [3, 5, ...Array(16).fill(null) as any[]],
      "rp-a2": [4, 5, ...Array(16).fill(null) as any[]],
      "rp-b1": [4, 4, ...Array(16).fill(null) as any[]],
      "rp-b2": [4, 4, ...Array(16).fill(null) as any[]]
    });
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "best_ball_gross",
          config: { match_play: true }
        }),
        players,
        scores,
        course: { holes, par: 72 }
      })
    );
    expect(state!.variant).toBe("team_match");
    const seg = state!.segments[0];
    expect(seg.match_play).toBe(true);
    expect(seg.a_holes_won).toBe(1);
    expect(seg.b_holes_won).toBe(1);
    expect(seg.a_up).toBe(0);
    expect(fmtSegmentStatus(seg)).toBe("Tied thru 2");
  });
});

describe("buildLiveMatchState: live auto-press visibility", () => {
  const PARS18 = PARS;
  const players4 = [
    makePlayer({ id: "rp-pat", name: "Pat" }),
    makePlayer({ id: "rp-ben", name: "Ben" }),
    makePlayer({ id: "rp-mit", name: "Mit" }),
    makePlayer({ id: "rp-kyl", name: "Kyl" })
  ];
  const holes = makeHoles(PARS18);

  it("6-6-6 without presses config returns auto_presses=[] on every segment", () => {
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "six_six_six",
          name: "6-6-6",
          config: { net: false, match_play: true }
        }),
        players: players4,
        scores: [],
        course: { holes, par: 72 }
      })
    );
    for (const seg of state!.segments) {
      expect(seg.auto_presses).toEqual([]);
    }
  });

  it("6-6-6 with presses=auto_2_down: press fires when team goes 2 down mid-segment", () => {
    // Seg 1 (Pat+Ben vs Mit+Kyl): Mit+Kyl birdies holes 1 and 2 → Mit+Kyl
    // 2-up after hole 2 → press opens at hole 3 (B-direction).
    // No further scoring → press is live, no holes played yet inside it.
    const a = [4, 4, 4, 4, 4, 4, ...Array(12).fill(null) as any[]];
    const b = [4, 4, 4, 4, 4, 4, ...Array(12).fill(null) as any[]];
    const c = [3, 3, 4, 4, 4, 4, ...Array(12).fill(null) as any[]];
    const d = [3, 3, 4, 4, 4, 4, ...Array(12).fill(null) as any[]];
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "six_six_six",
          stake_cents: 500,
          config: { net: false, match_play: true, presses: "auto_2_down" }
        }),
        players: players4,
        scores: [
          ...a.map((g, i) => ({ round_player_id: "rp-pat", hole_number: i + 1, gross: g })),
          ...b.map((g, i) => ({ round_player_id: "rp-ben", hole_number: i + 1, gross: g })),
          ...c.map((g, i) => ({ round_player_id: "rp-mit", hole_number: i + 1, gross: g })),
          ...d.map((g, i) => ({ round_player_id: "rp-kyl", hole_number: i + 1, gross: g }))
        ],
        course: { holes, par: 72 }
      })
    );
    const seg1 = state!.segments[0];
    expect(seg1.auto_presses).toHaveLength(1);
    const press = seg1.auto_presses[0];
    expect(press.index).toBe(1);
    expect(press.trigger_hole).toBe(2);
    expect(press.start_hole).toBe(3);
    expect(press.end_hole).toBe(6);
    // Holes 3-6 are pushes — press is tied with 0 remaining
    expect(press.holes_played).toBe(4);
    expect(press.remaining).toBe(0);
    expect(press.a_up).toBe(0);
    expect(press.settled_delta).toBe(0);
  });

  it("Nassau with presses=auto_2_down: front press fires at hole 3 trigger; back segment still empty", () => {
    // Pat birdies holes 1+2, pars 3-6. Mit pars all 6.
    // Hole 1: Pat 3 vs Mit 4 → A up 1.
    // Hole 2: Pat 3 vs Mit 4 → A up 2 → press opens at hole 3.
    // Holes 3-6: all pushes.
    const players2 = [
      makePlayer({ id: "rp-a", name: "Pat", team_id: "team-a" }),
      makePlayer({ id: "rp-b", name: "Mit", team_id: "team-b" })
    ];
    const patScores = PARS18.slice(0, 6).map((p, i) => (i < 2 ? p - 1 : p));
    const mitScores = PARS18.slice(0, 6);
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "nassau",
          name: "Nassau",
          stake_cents: 1000,
          config: { net: false, match_play: true, presses: "auto_2_down" }
        }),
        players: players2,
        scores: [
          ...patScores.map((g, i) => ({ round_player_id: "rp-a", hole_number: i + 1, gross: g })),
          ...mitScores.map((g, i) => ({ round_player_id: "rp-b", hole_number: i + 1, gross: g }))
        ],
        course: { holes, par: 72 }
      })
    );
    const front = state!.segments.find((s) => s.segment_label === "Nassau front")!;
    expect(front.auto_presses).toHaveLength(1);
    expect(front.auto_presses[0].trigger_hole).toBe(2);
    expect(front.auto_presses[0].start_hole).toBe(3);
    // Back hasn't started.
    const back = state!.segments.find((s) => s.segment_label === "Nassau back")!;
    expect(back.auto_presses).toEqual([]);
  });

  it("team match-play with presses=auto_2_down: press fires once side B falls 2 down", () => {
    const players4Teams = [
      makePlayer({ id: "rp-a1", name: "Pat", team_id: "team-a" }),
      makePlayer({ id: "rp-a2", name: "Ben", team_id: "team-a" }),
      makePlayer({ id: "rp-b1", name: "Mit", team_id: "team-b" }),
      makePlayer({ id: "rp-b2", name: "Kyl", team_id: "team-b" })
    ];
    // Team A min wins holes 1+2 (3-4, 3-4).
    const scores = makeScores({
      "rp-a1": [3, 3, ...Array(16).fill(null) as any[]],
      "rp-a2": [4, 4, ...Array(16).fill(null) as any[]],
      "rp-b1": [4, 4, ...Array(16).fill(null) as any[]],
      "rp-b2": [4, 4, ...Array(16).fill(null) as any[]]
    });
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({
          game_type: "best_ball_gross",
          name: "Best Ball",
          stake_cents: 2000,
          config: { match_play: true, presses: "auto_2_down" }
        }),
        players: players4Teams,
        scores,
        course: { holes, par: 72 }
      })
    );
    const seg = state!.segments[0];
    expect(seg.auto_presses).toHaveLength(1);
    expect(seg.auto_presses[0].trigger_hole).toBe(2);
    expect(seg.auto_presses[0].start_hole).toBe(3);
  });

  it("fmtAutoPressStatus produces readable status lines for each phase", () => {
    // Live press, side A leading
    const p1 = {
      index: 1,
      trigger_hole: 2,
      start_hole: 3,
      end_hole: 6,
      total_holes: 4,
      holes_played: 2,
      remaining: 2,
      a_holes_won: 1,
      b_holes_won: 0,
      pushes: 1,
      a_up: 1,
      dormie_or_closed: null,
      settled_delta: null
    } as const;
    expect(fmtAutoPressStatus(p1, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · opened hole 2 · Pat + Ben up 1 thru 2"
    );
    // Tied
    const p2 = { ...p1, a_holes_won: 0, pushes: 2, a_up: 0 } as const;
    expect(fmtAutoPressStatus(p2, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · opened hole 2 · tied thru 2"
    );
    // Dormie
    const p3 = {
      ...p1,
      holes_played: 2,
      remaining: 2,
      a_holes_won: 2,
      pushes: 0,
      a_up: 2,
      dormie_or_closed: "dormie" as const
    };
    expect(fmtAutoPressStatus(p3, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · Pat + Ben dormie · 2 to play"
    );
    // Closed out by A
    const p4 = { ...p1, holes_played: 3, remaining: 1, a_holes_won: 3, pushes: 0, a_up: 3, dormie_or_closed: "closed_out_by_a" as const };
    expect(fmtAutoPressStatus(p4, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · Pat + Ben closed out · 3 & 1"
    );
    // Settled tied
    const p5 = { ...p1, holes_played: 4, remaining: 0, a_up: 0, settled_delta: 0 };
    expect(fmtAutoPressStatus(p5, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · finished — tied"
    );
    // Settled with B winning 2-0
    const p6 = {
      ...p1,
      holes_played: 4,
      remaining: 0,
      a_holes_won: 0,
      b_holes_won: 2,
      pushes: 2,
      a_up: -2,
      dormie_or_closed: null,
      settled_delta: -2
    } as const;
    expect(fmtAutoPressStatus(p6, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · finished — Mit + Kyl won 2-0"
    );
    // No holes played yet inside the press window
    const p7 = {
      ...p1,
      holes_played: 0,
      remaining: 4,
      a_holes_won: 0,
      pushes: 0,
      a_up: 0
    };
    expect(fmtAutoPressStatus(p7, "Pat + Ben", "Mit + Kyl")).toBe(
      "Press 1 · opened hole 2 · waiting on first scored hole"
    );
  });
});

describe("buildLiveMatchState: individual + skins return null (use other panels)", () => {
  it.each([
    "individual_gross",
    "individual_net",
    "skins_gross",
    "skins_net",
    "ctp",
    "long_drive",
    "custom"
  ] as const)("game_type=%s returns null", (gt) => {
    const state = buildLiveMatchState(
      makeInput({
        game: makeGame({ game_type: gt as any }),
        players: [makePlayer({ id: "rp-a", name: "Pat" })],
        scores: [],
        course: { holes: makeHoles(PARS), par: 72 }
      })
    );
    expect(state).toBeNull();
  });
});
