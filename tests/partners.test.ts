/**
 * Tests for `resolveActivePartners` — the source of truth the partner-
 * banner UI reads from. Mirrors the rotation source the settlement
 * engine uses (cfg.rotation when present, else AB-CD / AC-BD / AD-BC).
 */

import { describe, expect, it } from "vitest";
import { resolveActivePartners } from "../lib/games/partners";

const rps = [
  { id: "rp-a", display_name: "Pat" },
  { id: "rp-b", display_name: "Ben" },
  { id: "rp-c", display_name: "Mitch" },
  { id: "rp-d", display_name: "Kyle" }
];

describe("resolveActivePartners — 6-6-6 (default rotation)", () => {
  const g = {
    id: "g1",
    game_type: "six_six_six",
    name: "6-6-6",
    config: {}
  };

  it("Segment 1 (holes 1-6): AB vs CD", () => {
    const d = resolveActivePartners({ games: [g], rps, currentHole: 1 });
    expect(d).not.toBeNull();
    expect(d!.segment_label).toBe("Holes 1–6 · Segment 1 of 3");
    expect(d!.sides[0].player_names).toEqual(["Pat", "Ben"]);
    expect(d!.sides[0].player_ids).toEqual(["rp-a", "rp-b"]);
    expect(d!.sides[1].player_names).toEqual(["Mitch", "Kyle"]);
    expect(d!.sides[1].player_ids).toEqual(["rp-c", "rp-d"]);
    expect(d!.next_segment_starts_at).toBe(7);
    expect(d!.next_segment_label).toBe("Partners change at hole 7");
  });

  it("Segment 2 (holes 7-12): AC vs BD", () => {
    const d = resolveActivePartners({ games: [g], rps, currentHole: 7 });
    expect(d!.segment_label).toBe("Holes 7–12 · Segment 2 of 3");
    expect(d!.sides[0].player_names).toEqual(["Pat", "Mitch"]);
    expect(d!.sides[1].player_names).toEqual(["Ben", "Kyle"]);
    expect(d!.next_segment_starts_at).toBe(13);
  });

  it("Segment 3 (holes 13-18): AD vs BC, no next segment", () => {
    const d = resolveActivePartners({ games: [g], rps, currentHole: 13 });
    expect(d!.segment_label).toBe("Holes 13–18 · Segment 3 of 3");
    expect(d!.sides[0].player_names).toEqual(["Pat", "Kyle"]);
    expect(d!.sides[1].player_names).toEqual(["Ben", "Mitch"]);
    expect(d!.next_segment_starts_at).toBeUndefined();
    expect(d!.next_segment_label).toBeUndefined();
  });

  it("Boundary: hole 6 still in segment 1", () => {
    const d = resolveActivePartners({ games: [g], rps, currentHole: 6 });
    expect(d!.segment_label).toBe("Holes 1–6 · Segment 1 of 3");
  });

  it("Boundary: hole 7 is segment 2", () => {
    const d = resolveActivePartners({ games: [g], rps, currentHole: 7 });
    expect(d!.segment_label).toBe("Holes 7–12 · Segment 2 of 3");
  });
});

describe("resolveActivePartners — 6-6-6 (custom rotation)", () => {
  it("Custom config.rotation wins over default", () => {
    const g = {
      id: "g1",
      game_type: "six_six_six",
      name: "6-6-6",
      config: {
        rotation: [
          { team_a: ["rp-a", "rp-c"], team_b: ["rp-b", "rp-d"] },
          { team_a: ["rp-a", "rp-d"], team_b: ["rp-b", "rp-c"] },
          { team_a: ["rp-a", "rp-b"], team_b: ["rp-c", "rp-d"] }
        ]
      }
    };
    const d = resolveActivePartners({ games: [g], rps, currentHole: 1 });
    expect(d!.sides[0].player_names).toEqual(["Pat", "Mitch"]);
    expect(d!.sides[1].player_names).toEqual(["Ben", "Kyle"]);
  });
});

describe("resolveActivePartners — best ball / team_match (fixed teams)", () => {
  const rpsTeams = [
    { id: "rp-a", display_name: "Pat", team_id: "team-1" },
    { id: "rp-b", display_name: "Ben", team_id: "team-1" },
    { id: "rp-c", display_name: "Mitch", team_id: "team-2" },
    { id: "rp-d", display_name: "Kyle", team_id: "team-2" }
  ];

  it("Best ball: two teams, names grouped by team_id", () => {
    const g = {
      id: "g2",
      game_type: "best_ball_net",
      name: "Best ball (net)",
      config: {}
    };
    const d = resolveActivePartners({
      games: [g],
      rps: rpsTeams,
      currentHole: 1
    });
    expect(d).not.toBeNull();
    expect(d!.segment_label).toBe("Best-ball teams");
    expect(d!.sides).toHaveLength(2);
    expect(d!.sides[0].player_names).toEqual(["Pat", "Ben"]);
    expect(d!.sides[0].player_ids).toEqual(["rp-a", "rp-b"]);
    expect(d!.sides[1].player_names).toEqual(["Mitch", "Kyle"]);
    expect(d!.sides[1].player_ids).toEqual(["rp-c", "rp-d"]);
  });

  it("Scramble label", () => {
    const g = {
      id: "g3",
      game_type: "scramble_net",
      name: "Scramble (net)",
      config: {}
    };
    const d = resolveActivePartners({
      games: [g],
      rps: rpsTeams,
      currentHole: 1
    });
    expect(d!.segment_label).toBe("Scramble teams");
  });

  it("Returns null when only one team is set up (no opposing side)", () => {
    const lopsidedRps = [
      { id: "rp-a", display_name: "Pat", team_id: "team-1" },
      { id: "rp-b", display_name: "Ben", team_id: "team-1" },
      { id: "rp-c", display_name: "Mitch", team_id: null },
      { id: "rp-d", display_name: "Kyle", team_id: null }
    ];
    const g = {
      id: "g2",
      game_type: "best_ball_net",
      name: "Best ball (net)",
      config: {}
    };
    expect(
      resolveActivePartners({ games: [g], rps: lopsidedRps, currentHole: 1 })
    ).toBeNull();
  });
});

describe("resolveActivePartners — priority + edge cases", () => {
  it("6-6-6 wins over best_ball when both are enabled", () => {
    const games = [
      { id: "g1", game_type: "best_ball_net", name: "Best ball", config: {} },
      { id: "g2", game_type: "six_six_six", name: "6-6-6", config: {} }
    ];
    const d = resolveActivePartners({
      games,
      rps,
      currentHole: 1
    });
    expect(d!.game_id).toBe("g2");
    expect(d!.game_type).toBe("six_six_six");
  });

  it("Returns null when no partner game is enabled (just Skins)", () => {
    const games = [
      { id: "g1", game_type: "skins_net", name: "Skins", config: {} }
    ];
    expect(resolveActivePartners({ games, rps, currentHole: 1 })).toBeNull();
  });

  it("Returns null when 6-6-6 has wrong player count", () => {
    const threeRps = rps.slice(0, 3);
    const g = {
      id: "g1",
      game_type: "six_six_six",
      name: "6-6-6",
      config: {}
    };
    expect(
      resolveActivePartners({ games: [g], rps: threeRps, currentHole: 1 })
    ).toBeNull();
  });

  it("Returns null when 6-6-6 is enabled but round is only 9 holes", () => {
    const g = {
      id: "g1",
      game_type: "six_six_six",
      name: "6-6-6",
      config: {}
    };
    expect(
      resolveActivePartners({
        games: [g],
        rps,
        currentHole: 1,
        totalHoles: 9
      })
    ).toBeNull();
  });

  it("Returns null on empty inputs", () => {
    expect(
      resolveActivePartners({ games: [], rps, currentHole: 1 })
    ).toBeNull();
    expect(
      resolveActivePartners({
        games: [{ id: "g", game_type: "six_six_six", name: "6-6-6" }],
        rps: [],
        currentHole: 1
      })
    ).toBeNull();
  });
});
