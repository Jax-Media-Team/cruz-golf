import { describe, it, expect } from "vitest";
import {
  buildCareerMoney,
  buildClubhouse,
  buildCourseMasterySignals,
  buildGroupActivitySignal,
  buildGroupLifetimeSignal,
  buildHoleMasterySignals,
  buildLastRoundSignal,
  buildLiveRoundSignals,
  buildPartnerSignals,
  buildRecentMilestones,
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

// --- Course mastery ---------------------------------------------------

describe("buildCourseMasterySignals", () => {
  function rFull(
    id: string,
    date: string,
    course_id: string | null,
    course_name = "JGCC",
    holes = 18
  ): ClubhouseRound {
    return {
      id,
      date,
      status: "finalized",
      course_id,
      course_name,
      holes,
      spectator_token: null
    };
  }

  function makeScores(rpId: string, holes: number, par: number, gross: number) {
    const out: ClubhouseScore[] = [];
    for (let i = 1; i <= holes; i++) {
      out.push({ round_player_id: rpId, hole_number: i, par, gross });
    }
    return out;
  }

  it("returns nothing when no player has hit minRounds at any course", () => {
    const rounds = [
      rFull("r1", "2026-05-01", "c-jgcc"),
      rFull("r2", "2026-05-08", "c-jgcc")
    ];
    const rps = [
      rp("rp-pat-1", "r1", "p-pat", "Patrick"),
      rp("rp-pat-2", "r2", "p-pat", "Patrick")
    ];
    const scs = [
      ...makeScores("rp-pat-1", 18, 4, 4),
      ...makeScores("rp-pat-2", 18, 4, 4)
    ];
    expect(buildCourseMasterySignals(rounds, rps, scs)).toEqual([]);
  });

  it("picks the player with the lowest 18-hole-equivalent average gross", () => {
    const rounds = [
      rFull("r1", "2026-05-01", "c-jgcc"),
      rFull("r2", "2026-05-08", "c-jgcc"),
      rFull("r3", "2026-05-15", "c-jgcc")
    ];
    const rps: ClubhouseRoundPlayer[] = [];
    const scs: ClubhouseScore[] = [];
    for (let i = 1; i <= 3; i++) {
      rps.push(rp(`rp-pat-${i}`, `r${i}`, "p-pat", "Patrick"));
      rps.push(rp(`rp-mitch-${i}`, `r${i}`, "p-mitch", "Mitch"));
      // Patrick averages 78 (4 per hole + 6 = 78... actually let's
      // use round numbers). Patrick: 14 holes par-4, 4 holes par-5,
      // gross 4 on every par-4, gross 4 on every par-5 → 72. Mitch
      // gross 5 across the board → 90.
      scs.push(...makeScores(`rp-pat-${i}`, 18, 4, 4)); // 72
      scs.push(...makeScores(`rp-mitch-${i}`, 18, 4, 5)); // 90
    }
    const out = buildCourseMasterySignals(rounds, rps, scs);
    expect(out).toHaveLength(1);
    expect(out[0].course_id).toBe("c-jgcc");
    expect(out[0].leader.player_id).toBe("p-pat");
    expect(out[0].leader.avg_gross_18).toBe(72);
    expect(out[0].leader.best_gross).toBe(72);
    expect(out[0].leader.rounds_at_course).toBe(3);
    expect(out[0].runner_up?.player_id).toBe("p-mitch");
  });

  it("normalizes 9-hole rounds to 18 so 9s and 18s compare apples to apples", () => {
    // 3 9-hole rounds at gross 36 each → avg 9-hole 36 → avg 18-eq 72
    const rounds = [
      rFull("r1", "2026-05-01", "c-x", "X", 9),
      rFull("r2", "2026-05-08", "c-x", "X", 9),
      rFull("r3", "2026-05-15", "c-x", "X", 9)
    ];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A"),
      rp("rp-3", "r3", "p-a", "A")
    ];
    const scs = [
      ...makeScores("rp-1", 9, 4, 4),
      ...makeScores("rp-2", 9, 4, 4),
      ...makeScores("rp-3", 9, 4, 4)
    ];
    const out = buildCourseMasterySignals(rounds, rps, scs);
    expect(out[0].leader.avg_gross_18).toBe(72);
  });

  it("ignores rounds where fewer than 9 holes were scored", () => {
    const rounds = [
      rFull("r1", "2026-05-01", "c-x"),
      rFull("r2", "2026-05-08", "c-x"),
      rFull("r3", "2026-05-15", "c-x")
    ];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A"),
      rp("rp-3", "r3", "p-a", "A")
    ];
    const scs: ClubhouseScore[] = [
      // r1: only 4 holes scored → ignored
      { round_player_id: "rp-1", hole_number: 1, par: 4, gross: 4 },
      { round_player_id: "rp-1", hole_number: 2, par: 4, gross: 4 },
      { round_player_id: "rp-1", hole_number: 3, par: 4, gross: 4 },
      { round_player_id: "rp-1", hole_number: 4, par: 4, gross: 4 },
      ...makeScores("rp-2", 18, 4, 4),
      ...makeScores("rp-3", 18, 4, 4)
    ];
    // Only 2 valid rounds; default minRounds=3 → no signal.
    expect(buildCourseMasterySignals(rounds, rps, scs)).toEqual([]);
  });

  it("ignores live and draft rounds", () => {
    const rounds = [
      rFull("r1", "2026-05-01", "c-x"),
      rFull("r2", "2026-05-08", "c-x"),
      rFull("r3", "2026-05-15", "c-x"),
      { ...rFull("r-live", "2026-05-20", "c-x"), status: "live" as const }
    ];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A"),
      rp("rp-3", "r3", "p-a", "A"),
      rp("rp-live", "r-live", "p-a", "A")
    ];
    const scs = [
      ...makeScores("rp-1", 18, 4, 4),
      ...makeScores("rp-2", 18, 4, 4),
      ...makeScores("rp-3", 18, 4, 4),
      ...makeScores("rp-live", 18, 4, 3) // would lower the avg if counted
    ];
    const out = buildCourseMasterySignals(rounds, rps, scs);
    expect(out[0].leader.rounds_at_course).toBe(3);
    expect(out[0].leader.avg_gross_18).toBe(72);
  });

  it("sorts deepest-history courses first", () => {
    const rounds = [
      ...["r1", "r2", "r3", "r4", "r5"].map((id, i) =>
        rFull(id, `2026-05-0${i + 1}`, "c-deep", "Deep")
      ),
      ...["r6", "r7", "r8"].map((id, i) =>
        rFull(id, `2026-06-0${i + 1}`, "c-shallow", "Shallow")
      )
    ];
    const rps: ClubhouseRoundPlayer[] = [];
    const scs: ClubhouseScore[] = [];
    for (let i = 1; i <= 8; i++) {
      const rid = `r${i}`;
      const rpid = `rp-${i}`;
      rps.push(rp(rpid, rid, "p-a", "A"));
      scs.push(...makeScores(rpid, 18, 4, 4));
    }
    const out = buildCourseMasterySignals(rounds, rps, scs);
    expect(out.map((s) => s.course_id)).toEqual(["c-deep", "c-shallow"]);
  });
});

// --- Recent milestones ------------------------------------------------

describe("buildRecentMilestones", () => {
  function rFull(
    id: string,
    date: string,
    holes = 18,
    course_id: string | null = "c-x",
    course_name = "JGCC"
  ): ClubhouseRound {
    return {
      id,
      date,
      status: "finalized",
      course_id,
      course_name,
      holes,
      spectator_token: null
    };
  }

  function evenScores(rpId: string, holes: number, gross: number) {
    return Array.from({ length: holes }, (_, i) => ({
      round_player_id: rpId,
      hole_number: i + 1,
      par: 4,
      gross
    }));
  }

  it("fires broke_80 once on the first sub-80 18-hole round", () => {
    // 3 rounds; the second is the first sub-80.
    const rounds = [
      rFull("r1", "2026-05-01"),
      rFull("r2", "2026-05-08"),
      rFull("r3", "2026-05-15")
    ];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A"),
      rp("rp-3", "r3", "p-a", "A")
    ];
    // Round 1 gross 90, round 2 gross 78 (FIRST sub-80), round 3 gross 79.
    const scs = [
      ...evenScores("rp-1", 18, 5).slice(0, 18), // 90 — let's make this 90
      // 18 holes × 5 = 90. Good.
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-2",
        hole_number: i + 1,
        par: 4,
        gross: i < 12 ? 4 : 5 // 12*4 + 6*5 = 78
      })),
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-3",
        hole_number: i + 1,
        par: 4,
        gross: i < 11 ? 4 : 5 // 11*4 + 7*5 = 79
      }))
    ];
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 365,
      today: "2026-05-20"
    });
    const broke80s = out.filter((m) => m.kind === "broke_80");
    expect(broke80s).toHaveLength(1);
    expect(broke80s[0].round_id).toBe("r2");
    expect(broke80s[0].value).toBe(78);
  });

  it("filters milestones to within the windowDays cutoff", () => {
    // Sub-80 was 60 days ago; today's window is 14 days → no milestone.
    const rounds = [rFull("r-old", "2026-03-01"), rFull("r-recent", "2026-05-15")];
    const rps = [
      rp("rp-old", "r-old", "p-a", "A"),
      rp("rp-recent", "r-recent", "p-a", "A")
    ];
    const scs = [
      ...evenScores("rp-old", 18, 4).slice(0, 18), // 72 — broke 80
      ...evenScores("rp-recent", 18, 5).slice(0, 18) // 90 — broke nothing recent
    ];
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 14,
      today: "2026-05-20"
    });
    expect(out.find((m) => m.kind === "broke_80")).toBeUndefined();
  });

  it("only fires broke_90 when the player hasn't already broken 80", () => {
    // r1: 78 (breaks 80). r2: 88 — should NOT fire broke_90 since 80 already broken.
    const rounds = [rFull("r1", "2026-05-01"), rFull("r2", "2026-05-08")];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A")
    ];
    const scs = [
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-1",
        hole_number: i + 1,
        par: 4,
        gross: i < 12 ? 4 : 5
      })),
      ...evenScores("rp-2", 18, 4).map((s, i) => ({
        ...s,
        gross: i < 14 ? 4 : 6 // 14*4 + 4*6 = 80; 80 isn't strictly < 90 by sub-90 rule.
      }))
    ];
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 365,
      today: "2026-05-20"
    });
    expect(out.find((m) => m.kind === "broke_90")).toBeUndefined();
  });

  it("fires personal_best when a later 18-hole round beats every prior 18-hole gross", () => {
    const rounds = [
      rFull("r1", "2026-05-01"),
      rFull("r2", "2026-05-08"),
      rFull("r3", "2026-05-15")
    ];
    const rps = [
      rp("rp-1", "r1", "p-a", "A"),
      rp("rp-2", "r2", "p-a", "A"),
      rp("rp-3", "r3", "p-a", "A")
    ];
    // r1=85, r2=82, r3=79 → r3 is personal best (and breaks 80).
    const scs = [
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-1",
        hole_number: i + 1,
        par: 4,
        gross: i < 13 ? 4 : 6.5
      })).map((s) => ({ ...s, gross: Math.round(s.gross) })),
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-2",
        hole_number: i + 1,
        par: 4,
        gross: i < 14 ? 4 : 6.5
      })).map((s) => ({ ...s, gross: Math.round(s.gross) })),
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-3",
        hole_number: i + 1,
        par: 4,
        gross: i < 17 ? 4 : 11
      }))
    ];
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 365,
      today: "2026-05-20"
    });
    const pb = out.find((m) => m.kind === "personal_best");
    expect(pb).toBeDefined();
    expect(pb?.round_id).toBe("r3");
  });

  it("fires first_eagle on the hole that was 2+ under par", () => {
    const rounds = [rFull("r1", "2026-05-08")];
    const rps = [rp("rp-1", "r1", "p-a", "A")];
    const scs: ClubhouseScore[] = [
      // 18 holes: hole 7 is a par 5 the player aced for 3 (eagle).
      ...Array.from({ length: 18 }, (_, i) => ({
        round_player_id: "rp-1",
        hole_number: i + 1,
        par: i + 1 === 7 ? 5 : 4,
        gross: i + 1 === 7 ? 3 : 4
      }))
    ];
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 365,
      today: "2026-05-20"
    });
    const eagle = out.find((m) => m.kind === "first_eagle");
    expect(eagle).toBeDefined();
    expect(eagle?.value).toBe(7);
  });

  it("does NOT fire personal_best on the very first 18-hole round (baseline)", () => {
    const rounds = [rFull("r1", "2026-05-01")];
    const rps = [rp("rp-1", "r1", "p-a", "A")];
    const scs = evenScores("rp-1", 18, 4); // 72
    const out = buildRecentMilestones(rounds, rps, scs, {
      windowDays: 365,
      today: "2026-05-10"
    });
    expect(out.find((m) => m.kind === "personal_best")).toBeUndefined();
    // It would still fire a broke_80 (72 < 80, first time) since 72 is
    // an actual sub-80 round.
    expect(out.find((m) => m.kind === "broke_80")).toBeDefined();
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

// --- Hole mastery -----------------------------------------------------

describe("buildHoleMasterySignals", () => {
  it("returns nothing when no rounds are finalized", () => {
    const rounds = [r("r-live", "2026-05-10", "live")];
    const rps = [rp("rp1", "r-live", "p-mitch", "Mitch")];
    const scores = [score("rp1", 4, 4, 3)];
    expect(buildHoleMasterySignals(rounds, rps, scores)).toEqual([]);
  });

  it("requires ≥3 plays at the same (course, hole) to surface a leader", () => {
    // Mitch has played hole 4 at JGCC twice → below default minPlays=3,
    // so no signal even though he's the only candidate.
    const rounds = [
      r("r1", "2026-04-01", "finalized"),
      r("r2", "2026-04-15", "finalized")
    ];
    const rps = [
      rp("rp1", "r1", "p-mitch", "Mitch"),
      rp("rp2", "r2", "p-mitch", "Mitch")
    ];
    const scores = [
      score("rp1", 4, 4, 4),
      score("rp2", 4, 4, 3)
    ];
    expect(buildHoleMasterySignals(rounds, rps, scores)).toEqual([]);
  });

  it("picks the lowest-avg leader at each (course, hole) once minPlays met", () => {
    // Mitch plays hole 4 four times averaging 3.5; Patrick plays it three
    // times averaging 4.67. Mitch is the leader.
    const rounds = [
      r("r1", "2026-04-01", "finalized"),
      r("r2", "2026-04-08", "finalized"),
      r("r3", "2026-04-15", "finalized"),
      r("r4", "2026-04-22", "finalized")
    ];
    const rps = [
      rp("rp-m1", "r1", "p-mitch", "Mitch"),
      rp("rp-m2", "r2", "p-mitch", "Mitch"),
      rp("rp-m3", "r3", "p-mitch", "Mitch"),
      rp("rp-m4", "r4", "p-mitch", "Mitch"),
      rp("rp-p1", "r1", "p-pat", "Patrick"),
      rp("rp-p2", "r2", "p-pat", "Patrick"),
      rp("rp-p3", "r3", "p-pat", "Patrick")
    ];
    const scores = [
      // Mitch: 3, 4, 4, 3 → avg 3.5
      score("rp-m1", 4, 4, 3),
      score("rp-m2", 4, 4, 4),
      score("rp-m3", 4, 4, 4),
      score("rp-m4", 4, 4, 3),
      // Patrick: 4, 5, 5 → avg 4.67
      score("rp-p1", 4, 4, 4),
      score("rp-p2", 4, 4, 5),
      score("rp-p3", 4, 4, 5)
    ];
    const out = buildHoleMasterySignals(rounds, rps, scores);
    expect(out).toHaveLength(1);
    expect(out[0].hole_number).toBe(4);
    expect(out[0].leader.display_name).toBe("Mitch");
    expect(out[0].leader.avg_score).toBe(3.5);
    expect(out[0].leader.vs_par).toBe(-0.5);
    expect(out[0].leader.hole_count).toBe(4);
  });

  it("ignores null gross scores when computing the average", () => {
    const rounds = [
      r("r1", "2026-04-01", "finalized"),
      r("r2", "2026-04-15", "finalized"),
      r("r3", "2026-05-01", "finalized")
    ];
    const rps = [
      rp("rp1", "r1", "p-mitch", "Mitch"),
      rp("rp2", "r2", "p-mitch", "Mitch"),
      rp("rp3", "r3", "p-mitch", "Mitch")
    ];
    const scores = [
      score("rp1", 4, 4, 3),
      score("rp2", 4, 4, null), // ignored
      score("rp3", 4, 4, 4)
    ];
    // Only 2 valid plays → below default minPlays=3 → no signal.
    expect(buildHoleMasterySignals(rounds, rps, scores)).toEqual([]);
  });

  it("only counts finalized rounds — drafts/live/pending are skipped", () => {
    const rounds = [
      r("r-fin", "2026-04-01", "finalized"),
      r("r-pen", "2026-04-15", "pending_finalization"),
      r("r-live", "2026-05-01", "live"),
      r("r-draft", "2026-05-08", "draft")
    ];
    const rps = [
      rp("rp-fin", "r-fin", "p-mitch", "Mitch"),
      rp("rp-pen", "r-pen", "p-mitch", "Mitch"),
      rp("rp-live", "r-live", "p-mitch", "Mitch"),
      rp("rp-draft", "r-draft", "p-mitch", "Mitch")
    ];
    const scores = [
      score("rp-fin", 4, 4, 3),
      score("rp-pen", 4, 4, 3),
      score("rp-live", 4, 4, 3),
      score("rp-draft", 4, 4, 3)
    ];
    // Only 1 finalized play → below minPlays=3.
    expect(buildHoleMasterySignals(rounds, rps, scores)).toEqual([]);
  });

  it("sorts hardest-hole-first by leader vs_par (highest first)", () => {
    // Hole 4: leader avg 3.5, par 4 → vs_par = -0.5
    // Hole 7: leader avg 5.7, par 4 → vs_par = +1.7 (harder)
    // Hole 12: leader avg 5.0, par 5 → vs_par = 0.0
    // Expected order: hole 7, hole 12, hole 4.
    const rounds = ["r1", "r2", "r3"].map((id, i) =>
      r(id, `2026-04-0${i + 1}`, "finalized")
    );
    const rps = rounds.flatMap((rd) => [rp(`rp-${rd.id}`, rd.id, "p-mitch", "Mitch")]);
    const scores = rounds.flatMap((rd) => [
      score(`rp-${rd.id}`, 4, 4, 3 + (rd.id === "r1" ? 1 : 0)), // 4,3,3 → avg ~3.33 — actually all should be normalized
      // simpler: fixed scores per hole across rounds.
      score(`rp-${rd.id}`, 7, 4, 6),
      score(`rp-${rd.id}`, 12, 5, 5)
    ]);
    // Recompute hole 4: 4, 3, 3 → 3.33 → vs_par -0.67. Use that.
    const out = buildHoleMasterySignals(rounds, rps, scores);
    expect(out).toHaveLength(3);
    // Hardest first: hole 7 (vs_par > 0), then hole 12 (0), then hole 4 (negative).
    expect(out[0].hole_number).toBe(7);
    expect(out[1].hole_number).toBe(12);
    expect(out[2].hole_number).toBe(4);
  });

  it("respects minPlays override", () => {
    // Same data — at minPlays=2 both Mitch's 2 plays surface.
    const rounds = [
      r("r1", "2026-04-01", "finalized"),
      r("r2", "2026-04-15", "finalized")
    ];
    const rps = [
      rp("rp1", "r1", "p-mitch", "Mitch"),
      rp("rp2", "r2", "p-mitch", "Mitch")
    ];
    const scores = [
      score("rp1", 4, 4, 3),
      score("rp2", 4, 4, 4)
    ];
    expect(buildHoleMasterySignals(rounds, rps, scores)).toEqual([]);
    const lowered = buildHoleMasterySignals(rounds, rps, scores, { minPlays: 2 });
    expect(lowered).toHaveLength(1);
    expect(lowered[0].leader.hole_count).toBe(2);
  });

  it("scopes per-(course, hole) — same hole at different courses are separate signals", () => {
    const rounds = [
      r("r-jg-1", "2026-04-01", "finalized", "JGCC", "c-jgcc"),
      r("r-jg-2", "2026-04-08", "finalized", "JGCC", "c-jgcc"),
      r("r-jg-3", "2026-04-15", "finalized", "JGCC", "c-jgcc"),
      r("r-pv-1", "2026-04-22", "finalized", "PVIC Ocean", "c-pvic"),
      r("r-pv-2", "2026-04-29", "finalized", "PVIC Ocean", "c-pvic"),
      r("r-pv-3", "2026-05-06", "finalized", "PVIC Ocean", "c-pvic")
    ];
    const rps = rounds.map((rd) => rp(`rp-${rd.id}`, rd.id, "p-mitch", "Mitch"));
    const scores = rounds.map((rd) =>
      score(`rp-${rd.id}`, 4, 4, rd.course_name === "JGCC" ? 3 : 5)
    );
    const out = buildHoleMasterySignals(rounds, rps, scores);
    expect(out).toHaveLength(2);
    const jgcc = out.find((s) => s.course_name === "JGCC");
    const pvic = out.find((s) => s.course_name === "PVIC Ocean");
    expect(jgcc?.leader.avg_score).toBe(3);
    expect(pvic?.leader.avg_score).toBe(5);
  });
});
