/**
 * Partner resolution for partner-format games.
 *
 * Patrick 2026-05-13 #9: "In partner games, the app must clearly show
 * who is partnered with who... For rotating games like 6-6-6: show
 * current segment, show current partners, make it obvious when
 * partners change."
 *
 * Pure helper — takes the active games + round_players + current hole,
 * returns a structured partner descriptor the UI can render uniformly
 * across score-entry, leaderboard, and the round detail page.
 *
 * Supports:
 *   - 6-6-6 (rotating partners by segment, 1-6 / 7-12 / 13-18)
 *   - Best ball / scramble / aggregate / team_match (fixed teams by
 *     round_players.team_id)
 *
 * Reads the SAME rotation source the settlement engine uses (cfg.rotation
 * when present, else the canonical AB-CD / AC-BD / AD-BC fallback)
 * so what the scorer sees on the banner matches what the engine
 * actually settles.
 */

type AnyGame = {
  id: string;
  game_type: string;
  name: string;
  config?: any;
};

type AnyRP = {
  id: string; // round_player_id
  display_name: string;
  team_id?: string | null;
};

export type PartnerSide = {
  /** Label for this side — e.g. "Team A" or "Side 1". */
  side_label: string;
  /** Display names in stable order. */
  player_names: string[];
  /** round_player_ids in the same order as `player_names`. Consumers
   *  that need to act on the partner set (junk team-mode auto-assign,
   *  press side-A/B construction) should use this — name-based reverse
   *  lookup breaks when two players share a display_name. */
  player_ids: string[];
};

export type PartnerDescriptor = {
  /** Game that the partner config is sourced from. */
  game_id: string;
  game_name: string;
  game_type: string;
  /** Human-readable label for the active segment / team grouping.
   *  Examples: "Holes 1–6 · Segment 1", "Best ball teams". */
  segment_label: string;
  /** When the partners change at a future hole, this is the label of
   *  the next segment. Used to surface "Partners change at hole 7"
   *  warnings during 6-6-6 segment 1 / 2. */
  next_segment_label?: string;
  /** Hole at which the next segment begins (1-indexed, inclusive). */
  next_segment_starts_at?: number;
  /** The two (or more) sides for the current segment. */
  sides: PartnerSide[];
};

/**
 * Compute the active partner descriptor for the round.
 *
 * Priority order when multiple partner-style games are enabled:
 *   1. 6-6-6 (always wins — rotation is the most visible)
 *   2. team_match
 *   3. best_ball
 *   4. scramble
 *   5. aggregate
 *
 * Returns `null` when no partner game is active OR when the rps
 * aren't shaped right (not enough players, missing names, etc.) —
 * the UI should render nothing in that case.
 */
export function resolveActivePartners(args: {
  games: AnyGame[];
  rps: AnyRP[];
  currentHole: number;
  totalHoles?: number;
}): PartnerDescriptor | null {
  const { games, rps, currentHole } = args;
  const totalHoles = args.totalHoles ?? 18;
  if (!games || games.length === 0 || !rps || rps.length === 0) return null;

  // 1. 6-6-6 wins if present.
  const sixSixSix = games.find((g) => g.game_type === "six_six_six");
  if (sixSixSix && rps.length === 4 && totalHoles === 18) {
    return resolveSixSixSix(sixSixSix, rps, currentHole);
  }

  // 2-5. Fixed-team formats by priority.
  const teamGameTypes = [
    "team_match",
    "best_ball",
    "best_ball_gross",
    "best_ball_net",
    "scramble",
    "scramble_gross",
    "scramble_net",
    "aggregate",
    "aggregate_gross",
    "aggregate_net"
  ];
  for (const t of teamGameTypes) {
    const g = games.find((x) => x.game_type === t);
    if (g) {
      const desc = resolveFixedTeams(g, rps);
      if (desc) return desc;
    }
  }

  return null;
}

/**
 * 6-6-6 partner descriptor. Reads config.rotation if present (commissioner
 * customized the partner sequence in the rotation editor); otherwise
 * uses the canonical AB-CD / AC-BD / AD-BC default.
 */
function resolveSixSixSix(
  game: AnyGame,
  rps: AnyRP[],
  currentHole: number
): PartnerDescriptor {
  const cfg = (game.config ?? {}) as {
    rotation?: Array<{ team_a: [string, string]; team_b: [string, string] }>;
  };
  // Default rotation: A=0, B=1, C=2, D=3 (display_order)
  const [A, B, C, D] = rps.slice(0, 4);
  const defaultRotation = [
    { team_a: [A.id, B.id], team_b: [C.id, D.id] },
    { team_a: [A.id, C.id], team_b: [B.id, D.id] },
    { team_a: [A.id, D.id], team_b: [B.id, C.id] }
  ];
  const rotation = (cfg.rotation && cfg.rotation.length === 3
    ? cfg.rotation
    : defaultRotation) as Array<{ team_a: [string, string]; team_b: [string, string] }>;

  const segIdx = currentHole <= 6 ? 0 : currentHole <= 12 ? 1 : 2;
  const seg = rotation[segIdx];
  const segStart = segIdx === 0 ? 1 : segIdx === 1 ? 7 : 13;
  const segEnd = segIdx === 0 ? 6 : segIdx === 1 ? 12 : 18;

  const nameById = new Map(rps.map((r) => [r.id, r.display_name]));

  const nextIdx = segIdx + 1;
  const next = nextIdx < 3 ? rotation[nextIdx] : null;
  const nextStart = nextIdx === 1 ? 7 : nextIdx === 2 ? 13 : null;

  return {
    game_id: game.id,
    game_name: game.name,
    game_type: game.game_type,
    segment_label: `Holes ${segStart}–${segEnd} · Segment ${segIdx + 1} of 3`,
    next_segment_label:
      next && nextStart
        ? `Partners change at hole ${nextStart}`
        : undefined,
    next_segment_starts_at: nextStart ?? undefined,
    sides: [
      {
        side_label: "Side A",
        player_names: seg.team_a.map((id) => nameById.get(id) ?? "Player"),
        player_ids: [...seg.team_a]
      },
      {
        side_label: "Side B",
        player_names: seg.team_b.map((id) => nameById.get(id) ?? "Player"),
        player_ids: [...seg.team_b]
      }
    ]
  };
}

/**
 * Fixed-team descriptor for best_ball / scramble / aggregate / team_match.
 * Groups round_players by team_id; ignores players without a team_id
 * (they're either solo competitors in a mixed format or were never
 * assigned). Requires at least 2 teams to be meaningful.
 */
function resolveFixedTeams(
  game: AnyGame,
  rps: AnyRP[]
): PartnerDescriptor | null {
  const namesByTeam = new Map<string, string[]>();
  const idsByTeam = new Map<string, string[]>();
  for (const r of rps) {
    if (!r.team_id) continue;
    const names = namesByTeam.get(r.team_id) ?? [];
    names.push(r.display_name);
    namesByTeam.set(r.team_id, names);
    const ids = idsByTeam.get(r.team_id) ?? [];
    ids.push(r.id);
    idsByTeam.set(r.team_id, ids);
  }
  // Stable team ordering: keep teams in the order they first appear
  // in rps (which is `display_order` on the server side).
  const teamIdsInOrder: string[] = [];
  for (const r of rps) {
    if (!r.team_id) continue;
    if (!teamIdsInOrder.includes(r.team_id)) teamIdsInOrder.push(r.team_id);
  }
  if (teamIdsInOrder.length < 2) return null;

  return {
    game_id: game.id,
    game_name: game.name,
    game_type: game.game_type,
    segment_label:
      game.game_type.startsWith("scramble")
        ? "Scramble teams"
        : game.game_type.startsWith("best_ball")
        ? "Best-ball teams"
        : game.game_type.startsWith("aggregate")
        ? "Aggregate teams"
        : "Teams",
    sides: teamIdsInOrder.map((tid, i) => ({
      side_label: `Team ${String.fromCharCode(65 + i)}`,
      player_names: namesByTeam.get(tid) ?? [],
      player_ids: idsByTeam.get(tid) ?? []
    }))
  };
}
