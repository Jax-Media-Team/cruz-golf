import { describe, it, expect } from "vitest";
import {
  buildClubhouse,
  buildGroupActivitySignal,
  buildLiveRoundSignals,
  buildStreakSignals,
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
});
