import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, applyAllowance, emptyOutput, holesInPlay } from "./helpers";
import { detectAutoPresses, pressPotsBySide, type HoleResult } from "./press";

type TeamConfig = {
  /** When true, the game settles hole-by-hole match-play between the two
   *  teams. When false (default), it settles by total stroke count. */
  match_play?: boolean;
  /** Auto-press rule. Only respected when match_play=true. Same shape
   *  as Nassau presses. */
  presses?: "none" | "manual" | "auto_2_down";
};

/**
 * Best ball: each team's hole score = lowest of its players for that hole.
 *   - Every team member must have a score on every hole (each member
 *     plays their own ball). If any member's score is missing, the hole
 *     is incomplete and the team doesn't settle that hole.
 *
 * Aggregate: each team's hole score = sum of all players' scores for
 * that hole. Same completeness requirement as best ball (the sum is
 * meaningless if a member is missing).
 *
 * Scramble: each team's hole score = lowest of its players for that hole,
 * BUT only one team member needs to record (a real scramble has one shared
 * shot, so typically one scorer enters for the team). If at least one
 * member entered a score, the hole settles using min(entered). If every
 * team member entered the same number (group-score-pad pattern), this
 * collapses to the same result. This match real golf-group behavior:
 * "the scorekeeper writes 4 in the team's box; nobody asks each player
 * to also tick their own card." (SCRAMBLE-ONE-ENTRY in ISSUE_TRACKER.md
 * resolved.)
 *
 * mode "gross" or "net" controls which score is used.
 *
 * Two settlement modes (per `cfg.match_play`):
 *   - stroke (default): lowest-total team wins the per-player stake
 *     from each non-winning team's players.
 *   - match-play: hole-by-hole — each hole's lower-team-score wins the
 *     hole, more-holes-won wins the match, ties push. Per-player
 *     stake distribution mirrors stroke-play.
 *
 * When match_play=true AND presses=auto_2_down, auto-presses fire when
 * a team is 2 down with 3+ holes left in the match — uses the same
 * detectAutoPresses primitive Nassau uses (lib/games/press.ts).
 */
export function settleTeamGame(
  input: GameInput,
  variant: "best_ball" | "aggregate" | "scramble",
  mode: "gross" | "net"
): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;
  if (stake <= 0) return out;

  const cfg = (input.game.config ?? {}) as TeamConfig;
  const matchPlay = cfg.match_play === true;

  const teams = new Map<UUID, UUID[]>();
  for (const p of input.players) {
    if (!p.team_id) continue;
    const arr = teams.get(p.team_id) ?? [];
    arr.push(p.id);
    teams.set(p.team_id, arr);
  }
  if (teams.size < 2) return out;

  // Net team games (best_ball_net, aggregate_net) honor allowance_pct.
  // Gross variants pass players through unchanged.
  const adjusted = mode === "net" ? applyAllowance(input.players, input.game.allowance_pct) : input.players;
  const sheets = new Map(
    adjusted.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  for (const id of input.players.map((p) => p.id)) addDelta(out.perPlayer, id, 0, "");

  const orderedHoles = holesInPlay(input);

  // First pass: compute per-hole team scores for both teams. Used by
  // both stroke and match-play settlement, plus the press primitive.
  type PerHole = {
    hole_number: number;
    teamScores: Map<UUID, number>;
    complete: boolean;
  };
  const perHole: PerHole[] = orderedHoles.map((h) => {
    const teamHoleScores = new Map<UUID, number>();
    let complete = true;
    for (const [teamId, playerIds] of teams) {
      const scores: number[] = [];
      let allMembersScored = true;
      for (const pid of playerIds) {
        const sheet = sheets.get(pid)!;
        const row = sheet.rows.find((r) => r.hole_number === h.hole_number);
        const v = mode === "gross" ? row?.gross : row?.net;
        if (v == null) {
          allMembersScored = false;
        } else {
          scores.push(v);
        }
      }
      // Completeness depends on the variant:
      //   - best_ball + aggregate: every team member must record their
      //     own score (each plays own ball; sum is meaningless if a
      //     member is missing).
      //   - scramble: one entry per team is enough — the scorer often
      //     writes the team's single shared score into just one of the
      //     player rows. As long as at least one member entered, we can
      //     settle the hole.
      const teamComplete =
        variant === "scramble"
          ? scores.length > 0
          : allMembersScored;
      if (!teamComplete) {
        complete = false;
      } else {
        const teamScore =
          variant === "best_ball" || variant === "scramble"
            ? Math.min(...scores)
            : scores.reduce((a, b) => a + b, 0);
        teamHoleScores.set(teamId, teamScore);
      }
    }
    return { hole_number: h.hole_number, teamScores: teamHoleScores, complete };
  });

  if (perHole.every((h) => !h.complete)) return out;

  if (matchPlay) {
    // ---- Match-play settlement ----
    // Need exactly two teams for match-play (it's head-to-head).
    if (teams.size !== 2) {
      // Fall through to stroke-play if the round has 3+ teams; match-play
      // doesn't extend cleanly to 3-way without an extra round-robin layer.
      return settleStroke(perHole, teams, stake, variant, mode, out, orderedHoles.length);
    }
    const teamIds = [...teams.keys()];
    const sideA = teams.get(teamIds[0])!;
    const sideB = teams.get(teamIds[1])!;

    let aHolesUp = 0;
    let played = 0;
    for (const h of perHole) {
      if (!h.complete) continue;
      played += 1;
      const aScore = h.teamScores.get(teamIds[0])!;
      const bScore = h.teamScores.get(teamIds[1])!;
      if (aScore < bScore) aHolesUp += 1;
      else if (bScore < aScore) aHolesUp -= 1;
    }

    // Match settles when every hole is complete (or aHolesUp's magnitude
    // exceeds remaining holes — but we're conservative and only settle
    // at the end for simplicity).
    const allComplete = perHole.every((h) => h.complete);
    if (allComplete && aHolesUp !== 0) {
      const winners = aHolesUp > 0 ? sideA : sideB;
      const losers = aHolesUp > 0 ? sideB : sideA;
      applyMatchPayout(out, winners, losers, stake, `${variant} ${mode} match`);
    }

    // Press settlement — only fires when matchPlay && presses=auto_2_down.
    if (cfg.presses === "auto_2_down") {
      const holeResults: HoleResult[] = perHole.map((h) => {
        if (!h.complete) {
          return {
            hole_number: h.hole_number,
            a_won: false,
            b_won: false,
            push: false,
            incomplete: true
          };
        }
        const aScore = h.teamScores.get(teamIds[0])!;
        const bScore = h.teamScores.get(teamIds[1])!;
        return {
          hole_number: h.hole_number,
          a_won: aScore < bScore,
          b_won: bScore < aScore,
          push: aScore === bScore,
          incomplete: false
        };
      });
      const presses = detectAutoPresses(holeResults, {
        triggerDown: 2,
        minRemainingHoles: 3,
        maxPresses: 4,
        stakeCents: stake,
        segmentLabel: `${variant} ${mode}`,
        segmentStart: 0,
        segmentEnd: holeResults.length
      });
      if (presses.length > 0) {
        const pots = pressPotsBySide(presses, sideA, sideB);
        for (const [pid, delta] of pots.entries()) {
          if (delta !== 0) {
            const pressLabels = presses
              .filter((p) => p.result_delta != null && p.result_delta !== 0)
              .map((p) => p.label)
              .join(" + ");
            addDelta(
              out.perPlayer,
              pid,
              delta,
              pressLabels || `${variant} ${mode} presses`
            );
          }
        }
      }
    }

    out.status = allComplete ? "final" : "live";
    return out;
  }

  // ---- Stroke-play settlement (legacy default) ----
  return settleStroke(perHole, teams, stake, variant, mode, out, orderedHoles.length);
}

type PerHole = {
  hole_number: number;
  teamScores: Map<UUID, number>;
  complete: boolean;
};

/**
 * Stroke-play team settlement: cumulative team total wins. Extracted so
 * match-play can fall back to it for 3+ team rounds where match-play
 * doesn't apply cleanly.
 */
function settleStroke(
  perHole: PerHole[],
  teams: Map<UUID, UUID[]>,
  stake: number,
  variant: "best_ball" | "aggregate" | "scramble",
  mode: "gross" | "net",
  out: GameOutput,
  totalHoles: number
): GameOutput {
  const teamTotals = new Map<UUID, number>();
  let holesScored = 0;
  for (const h of perHole) {
    if (!h.complete) continue;
    for (const [teamId, ts] of h.teamScores) {
      teamTotals.set(teamId, (teamTotals.get(teamId) ?? 0) + ts);
    }
    holesScored += 1;
  }
  if (teamTotals.size === 0 || holesScored === 0) return out;

  const lowest = Math.min(...teamTotals.values());
  const winningTeams = [...teamTotals.entries()].filter(([, v]) => v === lowest).map(([k]) => k);
  const losingTeams = [...teamTotals.entries()].filter(([, v]) => v !== lowest).map(([k]) => k);

  let pot = 0;
  for (const t of losingTeams) {
    for (const pid of teams.get(t)!) {
      addDelta(out.perPlayer, pid, -stake, `${variant} ${mode} team`);
      pot += stake;
    }
  }
  const winners: UUID[] = winningTeams.flatMap((t) => teams.get(t) ?? []);
  if (winners.length > 0 && pot > 0) {
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    winners.sort();
    winners.forEach((pid, i) =>
      addDelta(out.perPlayer, pid, each + (i < remainder ? 1 : 0), `${variant} ${mode} team`)
    );
  }

  out.status = holesScored === totalHoles ? "final" : "live";
  return out;
}

/**
 * Match-play payout — winners' team and losers' team known. Each loser
 * pays stake; pot splits among winners with deterministic remainder
 * (first sorted winner takes leftover cents). Mirrors Nassau's pattern.
 */
function applyMatchPayout(
  out: GameOutput,
  winners: UUID[],
  losers: UUID[],
  stake: number,
  label: string
) {
  if (winners.length === 0 || losers.length === 0 || stake <= 0) return;
  const pot = stake * losers.length;
  for (const id of losers) addDelta(out.perPlayer, id, -stake, label);
  const each = Math.floor(pot / winners.length);
  const remainder = pot - each * winners.length;
  const sorted = [...winners].sort();
  sorted.forEach((id, i) => {
    addDelta(out.perPlayer, id, each + (i < remainder ? 1 : 0), label);
  });
}
