import { describe, it, expect } from "vitest";
import {
  buildClubhouse,
  buildGroupActivitySignal,
  buildGroupLifetimeSignal,
  buildLiveRoundSignals,
  buildPartnerSignals,
  buildRivalrySignals,
  buildStreakSignals,
  fmtGroupSpan,
  fmtMoneyCents,
  fmtRelativeToPar,
  type ClubhouseRound,
  type ClubhouseRoundPlayer,
  type ClubhouseScore,
  type ClubhouseSettlement
} from "@/lib/clubhouse";

// Test data builders ---------------------------------------------------

function r(
  id: string,
  date: string,
  status: ClubhouseRound["status"],
  course = "JGCC",
  course_id: string | null = "c-jgcc"
): ClubhouseRound {
  return {
    id,
    date,
    status,
    course_name: course,
    course_id,
    spectator_token: status === "live" ? `tok-${id}` : null,
    holes: 18
  };
}

function rp(
  rpId: string,
  roundId: string,
  playerId: string,
  name: string
): ClubhouseRoundPlayer {
  return {
    round_player_id: rpId,
    round_id: roundId,
    player_id: playerId,
    display_name: name
  };
}

function score(rpId: string, hole: number, par: number, gross: number | null): ClubhouseScore {
  return { round_player_id: rpId, hole_number: hole, par, gross };
}

function settle(
  round_id: string,
  round_date: string,
  from: string,
  to: string,
  cents: number
): ClubhouseSettlement {
  return { round_id, round_date, from_round_player_id: from, to_round_player_id: to, amount_cents: cents };
}

// --- Live-round signals -----------------------------------------------

describe("buildLiveRoundSignals", () => {
  it("returns nothing when no rounds are live", () => {
    const out = buildLiveRoundSignals(
      [r("r1", "2026-05-10", "draft"), r("r2", "2026-05-09", "finalized")],
      [],
      []
    );
    expect(out).toEqual([]);
  });

  it("computes leader by lowest gross-vs-par on holes actually scored", () => {
    const rounds = [r("r1", "2026-05-10", "live")];
    const rps = [
      rp("rp-pat", "r1", "p-pat", "Patrick"),
      rp("rp-luis", "r1", "p-luis", "Luis"),
      rp("rp-ben", "r1", "p-ben", "Ben")
    ];
    const scores: ClubhouseScore[] = [
      // Patrick: 4 holes, +1 (3,4,4,4 vs par 3,4,4,3)
      score("rp-pat", 1, 3, 3),
      score("rp-pat", 2, 4, 4),
      score("rp-pat", 3, 4, 4),
      score("rp-pat", 4, 3, 4),
      // Luis: 7 holes, -2 (eagle on 1, par the rest)
      score("rp-luis", 1, 5, 3),
      score("rp-luis", 2, 4, 4),
      score("rp-luis", 3, 4, 4),
      score("rp-luis", 4, 3, 3),
      score("rp-luis", 5, 4, 4),
      score("rp-luis", 6, 4, 4),
      score("rp-luis", 7, 4, 4),
      // Ben: no scores yet
    ];
    const out = buildLiveRoundSignals(rounds, rps, scores);
    expect(out).toHaveLength(1);
    expect(out[0].leader).toEqual({
      display_name: "Luis",
      thru: 7,
      relative_to_par: -2
    });
    expect(out[0].active_players).toBe(2); // Ben hasn't scored
    expect(out[0].total_players).toBe(3);
    expect(out[0].spectator_token).toBe("tok-r1");
  });

  it("tie-breaks by who's further along when relative-to-par is equal", () => {
    const rounds = [r("r1", "2026-05-10", "live")];
    const rps = [
      rp("rp-a", "r1", "p-a", "A"),
      rp("rp-b", "r1", "p-b", "B")
    ];
    const scores = [
      // Both even par, but B has 9 holes, A has 5 — B is the leader.
      ...Array.from({ length: 5 }, (_, i) => score("rp-a", i + 1, 4, 4)),
      ...Array.from({ length: 9 }, (_, i) => score("rp-b", i + 1, 4, 4))
    ];
    const out = buildLiveRoundSignals(rounds, rps, scores);
    expect(out[0].leader?.display_name).toBe("B");
    expect(out[0].leader?.thru).toBe(9);
  });

  it("ignores null gross entries (queue rows that haven't synced yet)", () => {
    const rounds = [r("r1", "2026-05-10", "live")];
    const rps = [rp("rp-a", "r1", "p-a", "A")];
    const scores = [
      score("rp-a", 1, 4, null),
      score("rp-a", 2, 4, 4)
    ];
    const out = buildLiveRoundSignals(rounds, rps, scores);
    expect(out[0].leader?.thru).toBe(1);
  });

  it("returns leader: null when nobody has scored yet", () => {
    const rounds = [r("r1", "2026-05-10", "live")];
    const rps = [rp("rp-a", "r1", "p-a", "A")];
    const out = buildLiveRoundSignals(rounds, rps, []);
    expect(out[0].leader).toBeNull();
    expect(out[0].active_players).toBe(0);
  });

  it("sorts most-recent-dated round first", () => {
    const rounds = [
      r("old", "2026-05-08", "live"),
      r("new", "2026-05-10", "live"),
      r("mid", "2026-05-09", "live")
    ];
    const out = buildLiveRoundSignals(rounds, [], []);
    expect(out.map((s) => s.round_id)).toEqual(["new", "mid", "old"]);
  });
});

// --- Streak signals ---------------------------------------------------

describe("buildStreakSignals", () => {
  it("returns nothing when nobody has won 2+ in a row (default minStreak)", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-02", "finalized")
    ];
    const rps = [
      rp("rp-pat-1", "r1", "p-pat", "Patrick"),
      rp("rp-pat-2", "r2", "p-pat", "Patrick"),
      rp("rp-luis-1", "r1", "p-luis", "Luis"),
      rp("rp-luis-2", "r2", "p-luis", "Luis")
    ];
    // Patrick wins r1 (+10), loses r2 (-10). Luis loses r1 (-10), wins r2 (+10).
    const settles = [
      settle("r1", "2026-05-01", "rp-luis-1", "rp-pat-1", 1000),
      settle("r2", "2026-05-02", "rp-pat-2", "rp-luis-2", 1000)
    ];
    const out = buildStreakSignals(rps, settles, rounds);
    expect(out).toEqual([]);
  });

  it("counts only consecutive most-recent winning rounds", () => {
    // Patrick: lost (oldest) → won → won → won (newest). Streak = 3.
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized"),
      r("r3", "2026-05-15", "finalized"),
      r("r4", "2026-05-22", "finalized")
    ];
    const rps = [
      rp("rp-pat-1", "r1", "p-pat", "Patrick"),
      rp("rp-pat-2", "r2", "p-pat", "Patrick"),
      rp("rp-pat-3", "r3", "p-pat", "Patrick"),
      rp("rp-pat-4", "r4", "p-pat", "Patrick"),
      rp("rp-jeff-1", "r1", "p-jeff", "Jeff"),
      rp("rp-jeff-2", "r2", "p-jeff", "Jeff"),
      rp("rp-jeff-3", "r3", "p-jeff", "Jeff"),
      rp("rp-jeff-4", "r4", "p-jeff", "Jeff")
    ];
    const settles = [
      // r1: Patrick loses $10 to Jeff
      settle("r1", "2026-05-01", "rp-pat-1", "rp-jeff-1", 1000),
      // r2-r4: Patrick wins $5 each
      settle("r2", "2026-05-08", "rp-jeff-2", "rp-pat-2", 500),
      settle("r3", "2026-05-15", "rp-jeff-3", "rp-pat-3", 500),
      settle("r4", "2026-05-22", "rp-jeff-4", "rp-pat-4", 500)
    ];
    const out = buildStreakSignals(rps, settles, rounds);
    const pat = out.find((s) => s.player_id === "p-pat");
    expect(pat?.consecutive_wins).toBe(3);
    expect(pat?.total_cents).toBe(1500);
    // Jeff is 0-3 most-recent, so no streak.
    expect(out.find((s) => s.player_id === "p-jeff")).toBeUndefined();
  });

  it("breaks the streak at any non-positive round (loss OR push)", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized"),
      r("r3", "2026-05-15", "finalized")
    ];
    const rps = [
      rp("rp-a-1", "r1", "p-a", "A"),
      rp("rp-a-2", "r2", "p-a", "A"),
      rp("rp-a-3", "r3", "p-a", "A"),
      rp("rp-b-1", "r1", "p-b", "B"),
      rp("rp-b-2", "r2", "p-b", "B"),
      rp("rp-b-3", "r3", "p-b", "B")
    ];
    // r1 push (no settlements). r2 + r3 A wins.
    const settles = [
      settle("r2", "2026-05-08", "rp-b-2", "rp-a-2", 500),
      settle("r3", "2026-05-15", "rp-b-3", "rp-a-3", 500)
    ];
    const out = buildStreakSignals(rps, settles, rounds);
    const a = out.find((s) => s.player_id === "p-a");
    // Only 2 most-recent are wins; r1 is a push (net=0) but it's older
    // than the streak so it doesn't matter — streak is 2.
    expect(a?.consecutive_wins).toBe(2);
  });

  it("respects minStreak option", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized"),
      r("r3", "2026-05-15", "finalized"),
      r("r4", "2026-05-22", "finalized")
    ];
    const rps = [
      rp("rp-a-1", "r1", "p-a", "A"),
      rp("rp-a-2", "r2", "p-a", "A"),
      rp("rp-a-3", "r3", "p-a", "A"),
      rp("rp-a-4", "r4", "p-a", "A"),
      rp("rp-b-1", "r1", "p-b", "B"),
      rp("rp-b-2", "r2", "p-b", "B"),
      rp("rp-b-3", "r3", "p-b", "B"),
      rp("rp-b-4", "r4", "p-b", "B")
    ];
    const settles = [
      settle("r1", "2026-05-01", "rp-b-1", "rp-a-1", 100),
      settle("r2", "2026-05-08", "rp-b-2", "rp-a-2", 100),
      settle("r3", "2026-05-15", "rp-b-3", "rp-a-3", 100),
      settle("r4", "2026-05-22", "rp-b-4", "rp-a-4", 100)
    ];
    const lo = buildStreakSignals(rps, settles, rounds, { minStreak: 2 });
    const hi = buildStreakSignals(rps, settles, rounds, { minStreak: 5 });
    expect(lo.find((s) => s.player_id === "p-a")?.consecutive_wins).toBe(4);
    expect(hi).toEqual([]); // Streak is 4, threshold is 5
  });

  it("ignores live or draft rounds", () => {
    // Player has 1 finalized win + 1 live round. Streak should count
    // only the finalized win (1, below default min of 2 → omitted).
    const rounds = [
      r("rfin", "2026-05-01", "finalized"),
      r("rlive", "2026-05-08", "live")
    ];
    const rps = [
      rp("rp-a-fin", "rfin", "p-a", "A"),
      rp("rp-a-live", "rlive", "p-a", "A"),
      rp("rp-b-fin", "rfin", "p-b", "B")
    ];
    const settles = [
      settle("rfin", "2026-05-01", "rp-b-fin", "rp-a-fin", 100)
    ];
    const out = buildStreakSignals(rps, settles, rounds);
    expect(out).toEqual([]);
  });
});

// --- Group activity ---------------------------------------------------

describe("buildGroupActivitySignal", () => {
  it("counts only finalized rounds within the window", () => {
    const rounds = [
      r("r-old", "2026-04-01", "finalized"), // outside 30d window
      r("r-mid", "2026-05-01", "finalized"),
      r("r-new", "2026-05-09", "finalized"),
      r("r-live", "2026-05-10", "live") // not finalized
    ];
    const out = buildGroupActivitySignal(rounds, [], {
      windowDays: 30,
      today: "2026-05-10"
    });
    expect(out.rounds_recent).toBe(2);
    expect(out.window_days).toBe(30);
  });

  it("sums only settlements attached to in-window finalized rounds", () => {
    const rounds = [
      r("r-old", "2026-04-01", "finalized"),
      r("r-recent", "2026-05-01", "finalized")
    ];
    const settles = [
      settle("r-old", "2026-04-01", "rp-x", "rp-y", 5000), // outside window
      settle("r-recent", "2026-05-01", "rp-x", "rp-y", 1500),
      settle("r-recent", "2026-05-01", "rp-z", "rp-y", 700)
    ];
    const out = buildGroupActivitySignal(rounds, settles, {
      windowDays: 30,
      today: "2026-05-10"
    });
    expect(out.cents_moved_recent).toBe(2200);
  });

  it("picks the most-played course in the window", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized", "JGCC", "c-jgcc"),
      r("r2", "2026-05-02", "finalized", "JGCC", "c-jgcc"),
      r("r3", "2026-05-03", "finalized", "JGCC", "c-jgcc"),
      r("r4", "2026-05-04", "finalized", "TPC", "c-tpc"),
      r("r5", "2026-05-05", "finalized", "TPC", "c-tpc"),
      r("r6", "2026-04-01", "finalized", "Pebble", "c-pb") // outside window
    ];
    const out = buildGroupActivitySignal(rounds, [], {
      windowDays: 30,
      today: "2026-05-10"
    });
    expect(out.top_course?.course_id).toBe("c-jgcc");
    expect(out.top_course?.rounds).toBe(3);
  });

  it("returns top_course: null when there are no in-window finalized rounds", () => {
    const out = buildGroupActivitySignal(
      [r("r-live", "2026-05-10", "live")],
      [],
      { today: "2026-05-10" }
    );
    expect(out.top_course).toBeNull();
    expect(out.rounds_recent).toBe(0);
  });
});

// --- combined / formatting ---------------------------------------------

describe("buildClubhouse", () => {
  it("produces a fully populated bundle from a single dataset", () => {
    const rounds = [
      r("r-live", "2026-05-10", "live"),
      r("r-fin1", "2026-05-08", "finalized"),
      r("r-fin2", "2026-05-01", "finalized")
    ];
    const rps = [
      rp("rp-pat-live", "r-live", "p-pat", "Patrick"),
      rp("rp-pat-1", "r-fin1", "p-pat", "Patrick"),
      rp("rp-pat-2", "r-fin2", "p-pat", "Patrick"),
      rp("rp-luis-live", "r-live", "p-luis", "Luis"),
      rp("rp-luis-1", "r-fin1", "p-luis", "Luis"),
      rp("rp-luis-2", "r-fin2", "p-luis", "Luis")
    ];
    const scores = [
      score("rp-pat-live", 1, 4, 3),
      score("rp-pat-live", 2, 4, 4)
    ];
    const settles = [
      settle("r-fin1", "2026-05-08", "rp-luis-1", "rp-pat-1", 500),
      settle("r-fin2", "2026-05-01", "rp-luis-2", "rp-pat-2", 1000)
    ];
    const bundle = buildClubhouse({
      group_name: "Sunday Crew",
      rounds,
      rps,
      scores,
      settlements: settles,
      today: "2026-05-10"
    });
    expect(bundle.group_name).toBe("Sunday Crew");
    expect(bundle.live_rounds).toHaveLength(1);
    expect(bundle.live_rounds[0].leader?.display_name).toBe("Patrick");
    expect(bundle.streaks[0].display_name).toBe("Patrick");
    expect(bundle.streaks[0].consecutive_wins).toBe(2);
    expect(bundle.activity.rounds_recent).toBe(2);
    expect(bundle.activity.cents_moved_recent).toBe(1500);
  });
});

describe("formatters", () => {
  it("formats relative-to-par with explicit signs", () => {
    expect(fmtRelativeToPar(0)).toBe("E");
    expect(fmtRelativeToPar(-2)).toBe("-2");
    expect(fmtRelativeToPar(3)).toBe("+3");
  });

  it("formats money in whole dollars", () => {
    expect(fmtMoneyCents(0)).toBe("$0");
    expect(fmtMoneyCents(1500)).toBe("$15");
    expect(fmtMoneyCents(14500)).toBe("$145");
  });

  it("formats group span understatedly without artificial precision", () => {
    expect(fmtGroupSpan(0)).toBeNull();
    expect(fmtGroupSpan(-1)).toBeNull();
    expect(fmtGroupSpan(3)).toBe("3 days");
    expect(fmtGroupSpan(1)).toBe("1 day");
    expect(fmtGroupSpan(14)).toBe("2 weeks");
    expect(fmtGroupSpan(7)).toBe("1 week");
    expect(fmtGroupSpan(120)).toBe("4 months");
    expect(fmtGroupSpan(365 * 4)).toBe("4 years");
  });
});

// --- Rivalries --------------------------------------------------------

describe("buildRivalrySignals", () => {
  it("returns nothing when no pair has hit minRounds together", () => {
    // Two rounds, two players each — only 2 rounds together, default minRounds=3.
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized")
    ];
    const rps = [
      rp("rp-a-1", "r1", "p-a", "A"),
      rp("rp-b-1", "r1", "p-b", "B"),
      rp("rp-a-2", "r2", "p-a", "A"),
      rp("rp-b-2", "r2", "p-b", "B")
    ];
    const settles = [settle("r1", "2026-05-01", "rp-b-1", "rp-a-1", 100)];
    expect(buildRivalrySignals(rps, settles, rounds)).toEqual([]);
  });

  it("counts wins from whichever player netted strictly more in the round", () => {
    // 3 rounds together, A wins 2, B wins 1.
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized"),
      r("r3", "2026-05-15", "finalized")
    ];
    const rps = [
      rp("rp-a-1", "r1", "p-a", "A"),
      rp("rp-b-1", "r1", "p-b", "B"),
      rp("rp-a-2", "r2", "p-a", "A"),
      rp("rp-b-2", "r2", "p-b", "B"),
      rp("rp-a-3", "r3", "p-a", "A"),
      rp("rp-b-3", "r3", "p-b", "B")
    ];
    const settles = [
      // r1: A wins
      settle("r1", "2026-05-01", "rp-b-1", "rp-a-1", 500),
      // r2: B wins
      settle("r2", "2026-05-08", "rp-a-2", "rp-b-2", 500),
      // r3: A wins
      settle("r3", "2026-05-15", "rp-b-3", "rp-a-3", 1000)
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    expect(out).toHaveLength(1);
    const pair = out[0];
    expect(pair.rounds_together).toBe(3);
    // Pair is alphabetized by id, so p-a is A.
    expect(pair.player_a_id).toBe("p-a");
    expect(pair.a_wins).toBe(2);
    expect(pair.b_wins).toBe(1);
  });

  it("computes recent_run from the last round backward, breaking on push or flip", () => {
    // 5 rounds: A, A, B, A, A → run of 2 in A's favor (last two were A wins).
    const rounds = ["r1", "r2", "r3", "r4", "r5"].map((id, i) =>
      r(id, `2026-05-0${i + 1}`, "finalized")
    );
    const rps: ClubhouseRoundPlayer[] = [];
    for (const rid of ["r1", "r2", "r3", "r4", "r5"]) {
      rps.push(rp(`rp-a-${rid}`, rid, "p-a", "A"));
      rps.push(rp(`rp-b-${rid}`, rid, "p-b", "B"));
    }
    const settles = [
      settle("r1", "2026-05-01", "rp-b-r1", "rp-a-r1", 100), // A wins
      settle("r2", "2026-05-02", "rp-b-r2", "rp-a-r2", 100), // A wins
      settle("r3", "2026-05-03", "rp-a-r3", "rp-b-r3", 100), // B wins (breaks any run)
      settle("r4", "2026-05-04", "rp-b-r4", "rp-a-r4", 100), // A wins
      settle("r5", "2026-05-05", "rp-b-r5", "rp-a-r5", 100)  // A wins
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    expect(out[0].recent_run).toBe(2); // Last two rounds, A's direction.
  });

  it("recent_run is negative when B is the runner", () => {
    const rounds = ["r1", "r2", "r3", "r4"].map((id, i) =>
      r(id, `2026-05-0${i + 1}`, "finalized")
    );
    const rps: ClubhouseRoundPlayer[] = [];
    for (const rid of ["r1", "r2", "r3", "r4"]) {
      rps.push(rp(`rp-a-${rid}`, rid, "p-a", "A"));
      rps.push(rp(`rp-b-${rid}`, rid, "p-b", "B"));
    }
    const settles = [
      settle("r1", "2026-05-01", "rp-b-r1", "rp-a-r1", 100), // A
      settle("r2", "2026-05-02", "rp-a-r2", "rp-b-r2", 100), // B
      settle("r3", "2026-05-03", "rp-a-r3", "rp-b-r3", 100), // B
      settle("r4", "2026-05-04", "rp-a-r4", "rp-b-r4", 100)  // B
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    expect(out[0].recent_run).toBe(-3);
  });

  it("treats equal-net rounds as pushes and breaks any active run", () => {
    const rounds = ["r1", "r2", "r3", "r4"].map((id, i) =>
      r(id, `2026-05-0${i + 1}`, "finalized")
    );
    const rps: ClubhouseRoundPlayer[] = [];
    for (const rid of ["r1", "r2", "r3", "r4"]) {
      rps.push(rp(`rp-a-${rid}`, rid, "p-a", "A"));
      rps.push(rp(`rp-b-${rid}`, rid, "p-b", "B"));
    }
    const settles = [
      settle("r1", "2026-05-01", "rp-b-r1", "rp-a-r1", 100), // A wins
      settle("r2", "2026-05-02", "rp-b-r2", "rp-a-r2", 100), // A wins
      // r3 has no settlements → both have 0 net → push
      settle("r4", "2026-05-04", "rp-b-r4", "rp-a-r4", 100)  // A wins
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    expect(out[0].pushes).toBe(1);
    // recent_run only counts the run from the LAST non-push backward; r4 = +1.
    expect(out[0].recent_run).toBe(1);
  });

  it("alphabetizes the pair so the same matchup is one row regardless of order", () => {
    // Ensure A vs B and B vs A are not double-counted.
    const rounds = ["r1", "r2", "r3"].map((id, i) =>
      r(id, `2026-05-0${i + 1}`, "finalized")
    );
    // Insert rps in different orders across rounds to expose any bug.
    const rps = [
      rp("rp-1a", "r1", "p-a", "A"),
      rp("rp-1b", "r1", "p-b", "B"),
      rp("rp-2b", "r2", "p-b", "B"),
      rp("rp-2a", "r2", "p-a", "A"),
      rp("rp-3a", "r3", "p-a", "A"),
      rp("rp-3b", "r3", "p-b", "B")
    ];
    const settles = [
      settle("r1", "2026-05-01", "rp-1b", "rp-1a", 100),
      settle("r2", "2026-05-02", "rp-2b", "rp-2a", 100),
      settle("r3", "2026-05-03", "rp-3b", "rp-3a", 100)
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    expect(out).toHaveLength(1);
    expect(out[0].rounds_together).toBe(3);
  });

  it("sorts longest active streak first, then most lopsided", () => {
    // Two clean pairs in disjoint rounds so cross-pollination from a
    // third player doesn't distort each pair's per-round net comparison.
    //
    // X-Y in r1-r5 (5 rounds): Y, Y, X, X, X → run +3 for X.
    // X-Z in r6-r9 (4 rounds): X, X, X, X    → run +4 for X.
    //
    // X-Z (run 4) should rank above X-Y (run 3).
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-02", "finalized"),
      r("r3", "2026-05-03", "finalized"),
      r("r4", "2026-05-04", "finalized"),
      r("r5", "2026-05-05", "finalized"),
      r("r6", "2026-05-06", "finalized"),
      r("r7", "2026-05-07", "finalized"),
      r("r8", "2026-05-08", "finalized"),
      r("r9", "2026-05-09", "finalized")
    ];
    const rps: ClubhouseRoundPlayer[] = [
      // X-Y in r1-r5
      rp("rp-x-1", "r1", "p-x", "X"),
      rp("rp-y-1", "r1", "p-y", "Y"),
      rp("rp-x-2", "r2", "p-x", "X"),
      rp("rp-y-2", "r2", "p-y", "Y"),
      rp("rp-x-3", "r3", "p-x", "X"),
      rp("rp-y-3", "r3", "p-y", "Y"),
      rp("rp-x-4", "r4", "p-x", "X"),
      rp("rp-y-4", "r4", "p-y", "Y"),
      rp("rp-x-5", "r5", "p-x", "X"),
      rp("rp-y-5", "r5", "p-y", "Y"),
      // X-Z in r6-r9
      rp("rp-x-6", "r6", "p-x", "X"),
      rp("rp-z-6", "r6", "p-z", "Z"),
      rp("rp-x-7", "r7", "p-x", "X"),
      rp("rp-z-7", "r7", "p-z", "Z"),
      rp("rp-x-8", "r8", "p-x", "X"),
      rp("rp-z-8", "r8", "p-z", "Z"),
      rp("rp-x-9", "r9", "p-x", "X"),
      rp("rp-z-9", "r9", "p-z", "Z")
    ];
    const settles = [
      // X-Y outcomes Y,Y,X,X,X
      settle("r1", "2026-05-01", "rp-x-1", "rp-y-1", 100),
      settle("r2", "2026-05-02", "rp-x-2", "rp-y-2", 100),
      settle("r3", "2026-05-03", "rp-y-3", "rp-x-3", 100),
      settle("r4", "2026-05-04", "rp-y-4", "rp-x-4", 100),
      settle("r5", "2026-05-05", "rp-y-5", "rp-x-5", 100),
      // X-Z outcomes X,X,X,X
      settle("r6", "2026-05-06", "rp-z-6", "rp-x-6", 50),
      settle("r7", "2026-05-07", "rp-z-7", "rp-x-7", 50),
      settle("r8", "2026-05-08", "rp-z-8", "rp-x-8", 50),
      settle("r9", "2026-05-09", "rp-z-9", "rp-x-9", 50)
    ];
    const out = buildRivalrySignals(rps, settles, rounds);
    // X-Z (run 4) ranks above X-Y (run 3).
    expect(out[0].player_a_id === "p-x" && out[0].player_b_id === "p-z").toBe(true);
    expect(Math.abs(out[0].recent_run)).toBe(4);
  });
});

// --- Partner chemistry ------------------------------------------------

describe("buildPartnerSignals", () => {
  function rpTeam(
    rpId: string,
    roundId: string,
    playerId: string,
    name: string,
    teamId: string | null
  ): ClubhouseRoundPlayer {
    return {
      round_player_id: rpId,
      round_id: roundId,
      player_id: playerId,
      display_name: name,
      team_id: teamId
    };
  }

  it("ignores rps without a team_id", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized")
    ];
    const rps = [
      rpTeam("rp-a-1", "r1", "p-a", "A", null),
      rpTeam("rp-b-1", "r1", "p-b", "B", null),
      rpTeam("rp-a-2", "r2", "p-a", "A", null),
      rpTeam("rp-b-2", "r2", "p-b", "B", null)
    ];
    expect(buildPartnerSignals(rps, [], rounds)).toEqual([]);
  });

  it("aggregates W-L-P for partners across paired rounds", () => {
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized"),
      r("r3", "2026-05-15", "finalized")
    ];
    const rps = [
      // A + B paired in r1, r2, r3
      rpTeam("rp-a-1", "r1", "p-a", "A", "team-AB"),
      rpTeam("rp-b-1", "r1", "p-b", "B", "team-AB"),
      rpTeam("rp-a-2", "r2", "p-a", "A", "team-AB"),
      rpTeam("rp-b-2", "r2", "p-b", "B", "team-AB"),
      rpTeam("rp-a-3", "r3", "p-a", "A", "team-AB"),
      rpTeam("rp-b-3", "r3", "p-b", "B", "team-AB"),
      // Opposing team C + D
      rpTeam("rp-c-1", "r1", "p-c", "C", "team-CD"),
      rpTeam("rp-d-1", "r1", "p-d", "D", "team-CD"),
      rpTeam("rp-c-2", "r2", "p-c", "C", "team-CD"),
      rpTeam("rp-d-2", "r2", "p-d", "D", "team-CD"),
      rpTeam("rp-c-3", "r3", "p-c", "C", "team-CD"),
      rpTeam("rp-d-3", "r3", "p-d", "D", "team-CD")
    ];
    // r1: AB win $20 (split). r2: AB lose $20. r3: AB win $40.
    const settles = [
      settle("r1", "2026-05-01", "rp-c-1", "rp-a-1", 1000),
      settle("r1", "2026-05-01", "rp-d-1", "rp-b-1", 1000),
      settle("r2", "2026-05-08", "rp-a-2", "rp-c-2", 1000),
      settle("r2", "2026-05-08", "rp-b-2", "rp-d-2", 1000),
      settle("r3", "2026-05-15", "rp-c-3", "rp-a-3", 2000),
      settle("r3", "2026-05-15", "rp-d-3", "rp-b-3", 2000)
    ];
    const out = buildPartnerSignals(rps, settles, rounds);
    const ab = out.find(
      (p) =>
        (p.player_a_id === "p-a" && p.player_b_id === "p-b") ||
        (p.player_a_id === "p-b" && p.player_b_id === "p-a")
    );
    expect(ab).toBeDefined();
    expect(ab!.rounds).toBe(3);
    expect(ab!.wins).toBe(2);
    expect(ab!.losses).toBe(1);
    expect(ab!.combined_cents).toBe(2000 - 2000 + 4000); // $40 net to AB
  });

  it("respects minRounds (default 2)", () => {
    const rounds = [r("r1", "2026-05-01", "finalized")];
    const rps = [
      rpTeam("rp-a-1", "r1", "p-a", "A", "team-AB"),
      rpTeam("rp-b-1", "r1", "p-b", "B", "team-AB")
    ];
    expect(buildPartnerSignals(rps, [], rounds)).toEqual([]);
  });

  it("includes 3-player teams as all unordered pairs within the team", () => {
    // Team of 3 (A,B,C) wins together in r1 and r2.
    const rounds = [
      r("r1", "2026-05-01", "finalized"),
      r("r2", "2026-05-08", "finalized")
    ];
    const rps = [
      rpTeam("rp-a-1", "r1", "p-a", "A", "team-ABC"),
      rpTeam("rp-b-1", "r1", "p-b", "B", "team-ABC"),
      rpTeam("rp-c-1", "r1", "p-c", "C", "team-ABC"),
      rpTeam("rp-a-2", "r2", "p-a", "A", "team-ABC"),
      rpTeam("rp-b-2", "r2", "p-b", "B", "team-ABC"),
      rpTeam("rp-c-2", "r2", "p-c", "C", "team-ABC"),
      // Solo opponent that pays the team
      rpTeam("rp-x-1", "r1", "p-x", "X", "team-X"),
      rpTeam("rp-x-2", "r2", "p-x", "X", "team-X")
    ];
    const settles = [
      settle("r1", "2026-05-01", "rp-x-1", "rp-a-1", 100),
      settle("r1", "2026-05-01", "rp-x-1", "rp-b-1", 100),
      settle("r1", "2026-05-01", "rp-x-1", "rp-c-1", 100),
      settle("r2", "2026-05-08", "rp-x-2", "rp-a-2", 100),
      settle("r2", "2026-05-08", "rp-x-2", "rp-b-2", 100),
      settle("r2", "2026-05-08", "rp-x-2", "rp-c-2", 100)
    ];
    const out = buildPartnerSignals(rps, settles, rounds);
    // Three pairs: A-B, A-C, B-C, each with 2 rounds + 2 wins.
    const teamPairs = out.filter((p) =>
      ["p-a", "p-b", "p-c"].includes(p.player_a_id) &&
      ["p-a", "p-b", "p-c"].includes(p.player_b_id)
    );
    expect(teamPairs).toHaveLength(3);
    teamPairs.forEach((p) => {
      expect(p.rounds).toBe(2);
      expect(p.wins).toBe(2);
    });
  });
});

// --- Group lifetime ---------------------------------------------------

describe("buildGroupLifetimeSignal", () => {
  it("returns zeros when nothing's finalized", () => {
    const out = buildGroupLifetimeSignal(
      [r("r-live", "2026-05-10", "live")],
      [],
      { today: "2026-05-10" }
    );
    expect(out).toEqual({
      total_rounds: 0,
      total_cents_moved: 0,
      first_round_date: null,
      days_active: 0
    });
  });

  it("totals only finalized rounds and their settlements", () => {
    const rounds = [
      r("r-old", "2024-08-12", "finalized"),
      r("r-mid", "2025-06-01", "finalized"),
      r("r-new", "2026-05-08", "finalized"),
      r("r-live", "2026-05-10", "live"), // ignored
      r("r-draft", "2026-05-09", "draft") // ignored
    ];
    const settles = [
      settle("r-old", "2024-08-12", "rp-x", "rp-y", 1000),
      settle("r-mid", "2025-06-01", "rp-x", "rp-y", 2000),
      settle("r-new", "2026-05-08", "rp-x", "rp-y", 5000),
      settle("r-live", "2026-05-10", "rp-x", "rp-y", 9999) // ignored
    ];
    const out = buildGroupLifetimeSignal(rounds, settles, {
      today: "2026-05-10"
    });
    expect(out.total_rounds).toBe(3);
    expect(out.total_cents_moved).toBe(8000);
    expect(out.first_round_date).toBe("2024-08-12");
    expect(out.days_active).toBeGreaterThan(600); // ~21 months
  });
});
