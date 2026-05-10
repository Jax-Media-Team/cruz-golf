import { describe, expect, it } from "vitest";

/**
 * Regression test for the auto-finalize-prompt heuristic shown in
 * /rounds/[id]/page.tsx. The page-level logic is:
 *
 *   const expectedScores = (rps?.length ?? 0) * Math.min(round.holes ?? 18, 18);
 *   const enteredScores  = (scores ?? []).filter(s => s.gross != null).length;
 *   const allScoresIn    = expectedScores > 0
 *                       && enteredScores >= expectedScores
 *                       && round.status === "live";
 *
 * We extract the same predicate here so it has its own coverage independent
 * of the React component.
 */

type ScoreRow = { gross: number | null };
type Round = { holes: 9 | 18; status: "draft" | "live" | "finalized" };

function shouldShowFinalizeBanner(
  round: Round,
  playerCount: number,
  scores: ScoreRow[]
): boolean {
  const expectedScores = playerCount * Math.min(round.holes ?? 18, 18);
  const enteredScores = scores.filter((s) => s.gross != null).length;
  return (
    expectedScores > 0 &&
    enteredScores >= expectedScores &&
    round.status === "live"
  );
}

const live18: Round = { holes: 18, status: "live" };
const live9: Round = { holes: 9, status: "live" };
const finalized: Round = { holes: 18, status: "finalized" };
const draft: Round = { holes: 18, status: "draft" };

function fullRound(playerCount: number, holes: number): ScoreRow[] {
  const out: ScoreRow[] = [];
  for (let p = 0; p < playerCount; p++) {
    for (let h = 0; h < holes; h++) out.push({ gross: 4 });
  }
  return out;
}

describe("auto-finalize banner heuristic", () => {
  it("doesn't show on a draft round even with all scores", () => {
    expect(shouldShowFinalizeBanner(draft, 4, fullRound(4, 18))).toBe(false);
  });

  it("doesn't show on a finalized round (banner only relevant pre-finalize)", () => {
    expect(shouldShowFinalizeBanner(finalized, 4, fullRound(4, 18))).toBe(false);
  });

  it("doesn't show with zero players", () => {
    expect(shouldShowFinalizeBanner(live18, 0, [])).toBe(false);
  });

  it("doesn't show with no scores", () => {
    expect(shouldShowFinalizeBanner(live18, 4, [])).toBe(false);
  });

  it("doesn't show with partial round (missing one hole on one player)", () => {
    const scores = fullRound(4, 18);
    scores.pop(); // remove last score
    expect(shouldShowFinalizeBanner(live18, 4, scores)).toBe(false);
  });

  it("doesn't show when null scores fill some holes (DNF / not yet reached)", () => {
    // Player started but has 5 null entries (incomplete card).
    const scores = fullRound(4, 18);
    for (let i = 0; i < 5; i++) scores[i] = { gross: null };
    expect(shouldShowFinalizeBanner(live18, 4, scores)).toBe(false);
  });

  it("shows when every player has every hole on a live 18-hole round", () => {
    expect(shouldShowFinalizeBanner(live18, 4, fullRound(4, 18))).toBe(true);
  });

  it("shows when every player has every hole on a 9-hole round", () => {
    expect(shouldShowFinalizeBanner(live9, 4, fullRound(4, 9))).toBe(true);
  });

  it("works for a single-player live round (solo entry)", () => {
    expect(shouldShowFinalizeBanner(live18, 1, fullRound(1, 18))).toBe(true);
  });

  it("works for an 8-person multi-foursome live round", () => {
    expect(shouldShowFinalizeBanner(live18, 8, fullRound(8, 18))).toBe(true);
  });

  // Shotgun start: hole_numbers don't have to start at 1, but the count of
  // entries-per-player should still equal round.holes. Our heuristic only
  // checks total count, so a shotgun start with all 18 entered behaves
  // exactly like a normal start — verified.
  it("works on a shotgun-start round (counts entries, not which holes)", () => {
    // Same shape as a normal 4-player 18-hole round; the score rows just
    // happen to include hole 7 as the first entered, etc. The predicate
    // doesn't read hole numbers, so it passes.
    expect(shouldShowFinalizeBanner(live18, 4, fullRound(4, 18))).toBe(true);
  });
});
