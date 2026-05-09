import type { GameInput, GameOutput, UUID } from "../types";
import { buildPlayerSheet } from "../scoring";
import { addDelta, emptyOutput, holesInPlay } from "./helpers";

/**
 * Best ball: each team's hole score = lowest of its players for that hole.
 * Aggregate: each team's hole score = sum of all players' scores for that hole.
 * mode "gross" or "net" controls which score is used.
 * Settlement: lowest-total team wins the per-player stake from each non-winning team's players.
 */
export function settleTeamGame(
  input: GameInput,
  variant: "best_ball" | "aggregate",
  mode: "gross" | "net"
): GameOutput {
  const out = emptyOutput();
  const stake = input.game.stake_cents;
  if (stake <= 0) return out;

  const teams = new Map<UUID, UUID[]>();
  for (const p of input.players) {
    if (!p.team_id) continue;
    const arr = teams.get(p.team_id) ?? [];
    arr.push(p.id);
    teams.set(p.team_id, arr);
  }
  if (teams.size < 2) return out;

  const sheets = new Map(
    input.players.map((p) => [p.id, buildPlayerSheet(p, input.scores, input.course.holes)])
  );
  for (const id of input.players.map((p) => p.id)) addDelta(out.perPlayer, id, 0, "");

  const orderedHoles = holesInPlay(input);
  const teamTotals = new Map<UUID, number>();
  let holesScored = 0;

  for (const h of orderedHoles) {
    let allHaveScore = true;
    const teamHoleScores = new Map<UUID, number>();
    for (const [teamId, playerIds] of teams) {
      const scores: number[] = [];
      for (const pid of playerIds) {
        const sheet = sheets.get(pid)!;
        const row = sheet.rows.find((r) => r.hole_number === h.hole_number);
        const v = mode === "gross" ? row?.gross : row?.net;
        if (v == null) {
          allHaveScore = false;
        } else {
          scores.push(v);
        }
      }
      if (!allHaveScore) break;
      const teamScore = variant === "best_ball" ? Math.min(...scores) : scores.reduce((a, b) => a + b, 0);
      teamHoleScores.set(teamId, teamScore);
    }
    // Skip incomplete holes but keep evaluating later complete ones — don't lock
    // out subsequent fully-scored holes if a middle hole is missing.
    if (!allHaveScore) continue;
    for (const [teamId, ts] of teamHoleScores) {
      teamTotals.set(teamId, (teamTotals.get(teamId) ?? 0) + ts);
    }
    holesScored += 1;
  }

  if (teamTotals.size === 0 || holesScored === 0) return out;

  const lowest = Math.min(...teamTotals.values());
  const winningTeams = [...teamTotals.entries()].filter(([, v]) => v === lowest).map(([k]) => k);
  const losingTeams = [...teamTotals.entries()].filter(([, v]) => v !== lowest).map(([k]) => k);

  // Each player on a losing team pays `stake`. Pot is split per-player among winning team(s).
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

  out.status = holesScored === orderedHoles.length ? "final" : "live";
  return out;
}
