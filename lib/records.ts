/**
 * Record Books — shared query + aggregation used by all three scopes:
 *
 *   /records           Group / Friends record book (everyone in your group)
 *   /records/me        Personal record book (just your finalized rounds)
 *   /records/course/X  Per-course record book (your group's rounds at X)
 *
 * The scope is just a `roundFilter` predicate; the records math is identical.
 * Group privacy is preserved across all three: every record query starts
 * from rounds.group_id IN (your groups), then narrows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RoundPerf = {
  round_id: string;
  rp_id: string;
  player_id: string;
  display_name: string;
  gross: number;
  holesCount: number;
  par_played: number;
  birdies: number;
  date: string;
  course: string | null;
  holes_scheduled: number;
};

export type RecordsBundle = {
  groupName: string | null;
  perfs: RoundPerf[];
  moneyByRp: Map<string, number>;
  rounds: Array<{ id: string; date: string; holes: number; course: string | null }>;
  /** Same data, indexed by round_id for fast lookup. */
  roundsById: Map<string, { id: string; date: string; holes: number; course: string | null }>;
};

export type RecordScope = {
  /** Filter rounds before pulling round_players. Examples:
   *   - undefined  -> entire group
   *   - { course_id }   -> per-course
   */
  courseId?: string;
  /** When set, only include rps for that player_id. Used by /records/me. */
  playerId?: string;
};

/**
 * Pull the data needed to render any record book in the user's group.
 * Returns RoundPerf[] (one row per round_player + round) plus money by rp.
 */
export async function loadRecords(
  sb: SupabaseClient<any, any, any>,
  groupId: string,
  scope: RecordScope = {}
): Promise<RecordsBundle> {
  const { data: groupRow } = await sb
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .maybeSingle();

  // 1. Rounds (already group-scoped by RLS, but be explicit).
  let roundsQ = sb
    .from("rounds")
    .select("id, date, holes, courses(name), course_id")
    .eq("group_id", groupId)
    .eq("status", "finalized")
    .order("date", { ascending: true });
  if (scope.courseId) roundsQ = roundsQ.eq("course_id", scope.courseId);
  // Filter archived rounds when the column exists (defensive: 0021 may not be
  // applied in some envs). PostgREST's .is on a missing column would error;
  // guard with a try/catch on the query result.
  const roundsRes = await roundsQ;
  const archivedFiltered = (roundsRes.data ?? []).filter(
    (r: any) => !("deleted_at" in r) || r.deleted_at == null
  );

  const rounds = archivedFiltered.map((r: any) => ({
    id: r.id as string,
    date: r.date as string,
    holes: (r.holes ?? 18) as number,
    course: (r.courses?.name as string | undefined) ?? null
  }));
  const roundIds = rounds.map((r) => r.id);
  const safeRoundIds = roundIds.length > 0 ? roundIds : ["00000000-0000-0000-0000-000000000000"];
  const roundsById = new Map(rounds.map((r) => [r.id, r]));

  // 2. Round players.
  let rpQ = sb
    .from("round_players")
    .select(
      "id, round_id, player_id, course_handicap, playing_handicap, players(display_name), course_tees(course_holes(hole_number, par))"
    )
    .in("round_id", safeRoundIds);
  if (scope.playerId) rpQ = rpQ.eq("player_id", scope.playerId);
  const { data: rps } = await rpQ;

  const rpIds = (rps ?? []).map((rp: any) => rp.id);
  const safeRpIds = rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"];

  // 3. Scores + settlements.
  const [{ data: scoreRows }, { data: settlements }] = await Promise.all([
    sb
      .from("scores")
      .select("round_player_id, hole_number, gross")
      .in("round_player_id", safeRpIds),
    sb
      .from("settlements")
      .select("round_id, from_round_player_id, to_round_player_id, amount_cents")
      .in("round_id", safeRoundIds)
  ]);

  // 4. Aggregate gross + holes + birdies per round_player.
  const perfs: RoundPerf[] = [];
  for (const rp of (rps ?? []) as any[]) {
    const holes = (rp.course_tees?.course_holes ?? []) as Array<{
      hole_number: number;
      par: number;
    }>;
    const parByHole = new Map(holes.map((h) => [h.hole_number, h.par]));
    let gross = 0;
    let count = 0;
    let parPlayed = 0;
    let birdies = 0;
    for (const s of (scoreRows ?? []) as any[]) {
      if (s.round_player_id !== rp.id) continue;
      if (s.gross == null) continue;
      gross += s.gross;
      count += 1;
      const par = parByHole.get(s.hole_number) ?? 4;
      parPlayed += par;
      if (s.gross < par) birdies += 1;
    }
    if (count === 0) continue;
    const r = roundsById.get(rp.round_id);
    perfs.push({
      round_id: rp.round_id,
      rp_id: rp.id,
      player_id: rp.player_id,
      display_name: rp.players?.display_name ?? "Player",
      gross,
      holesCount: count,
      par_played: parPlayed,
      birdies,
      date: r?.date ?? "",
      course: r?.course ?? null,
      holes_scheduled: r?.holes ?? 18
    });
  }

  // 5. Money by round_player.
  const moneyByRp = new Map<string, number>();
  for (const s of (settlements ?? []) as any[]) {
    moneyByRp.set(
      s.from_round_player_id,
      (moneyByRp.get(s.from_round_player_id) ?? 0) - s.amount_cents
    );
    moneyByRp.set(
      s.to_round_player_id,
      (moneyByRp.get(s.to_round_player_id) ?? 0) + s.amount_cents
    );
  }

  return {
    groupName: groupRow?.name ?? null,
    perfs,
    moneyByRp,
    rounds,
    roundsById
  };
}

// ---- record extraction helpers ----

export type RecordRow = {
  name: string;
  value: string;
  meta: string;
  tone?: "win" | "loss";
};

const projectGross18 = (g: number, played: number) => Math.round(g * (18 / Math.max(1, played)));

export function lowestGross18(perfs: RoundPerf[], roundLabel: (id: string) => string): RecordRow[] {
  return perfs
    .filter((p) => p.holes_scheduled === 18 && p.holesCount === 18)
    .sort((a, b) => a.gross - b.gross)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: String(p.gross),
      meta: roundLabel(p.round_id)
    }));
}

export function highestGross18(perfs: RoundPerf[], roundLabel: (id: string) => string): RecordRow[] {
  return perfs
    .filter((p) => p.holes_scheduled === 18 && p.holesCount === 18)
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: String(p.gross),
      meta: roundLabel(p.round_id)
    }));
}

export function lowestGross9(perfs: RoundPerf[], roundLabel: (id: string) => string): RecordRow[] {
  return perfs
    .filter((p) => p.holes_scheduled === 9 && p.holesCount === 9)
    .sort((a, b) => a.gross - b.gross)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: String(p.gross),
      meta: roundLabel(p.round_id)
    }));
}

export function biggestWins(
  perfs: RoundPerf[],
  moneyByRp: Map<string, number>,
  roundLabel: (id: string) => string
): RecordRow[] {
  return perfs
    .map((p) => ({ ...p, money: moneyByRp.get(p.rp_id) ?? 0 }))
    .filter((p) => p.money > 0)
    .sort((a, b) => b.money - a.money)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: fmtMoney(p.money),
      tone: "win" as const,
      meta: roundLabel(p.round_id)
    }));
}

export function biggestLosses(
  perfs: RoundPerf[],
  moneyByRp: Map<string, number>,
  roundLabel: (id: string) => string
): RecordRow[] {
  return perfs
    .map((p) => ({ ...p, money: moneyByRp.get(p.rp_id) ?? 0 }))
    .filter((p) => p.money < 0)
    .sort((a, b) => a.money - b.money)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: fmtMoney(p.money),
      tone: "loss" as const,
      meta: roundLabel(p.round_id)
    }));
}

export function mostBirdiesInRound(perfs: RoundPerf[], roundLabel: (id: string) => string): RecordRow[] {
  return perfs
    .filter((p) => p.birdies > 0)
    .sort((a, b) => b.birdies - a.birdies)
    .slice(0, 5)
    .map((p) => ({
      name: p.display_name,
      value: String(p.birdies),
      meta: roundLabel(p.round_id)
    }));
}

export function mostRoundsPlayed(perfs: RoundPerf[]): RecordRow[] {
  const m = new Map<string, { name: string; count: number }>();
  for (const p of perfs) {
    const e = m.get(p.player_id) ?? { name: p.display_name, count: 0 };
    e.count += 1;
    m.set(p.player_id, e);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([_, e]) => ({ name: e.name, value: String(e.count), meta: "" }));
}

export function seasonNetTop(
  perfs: RoundPerf[],
  moneyByRp: Map<string, number>
): RecordRow[] {
  const m = new Map<string, { name: string; net: number; rounds: number }>();
  for (const p of perfs) {
    const e = m.get(p.player_id) ?? { name: p.display_name, net: 0, rounds: 0 };
    e.net += moneyByRp.get(p.rp_id) ?? 0;
    e.rounds += 1;
    m.set(p.player_id, e);
  }
  return [...m.values()]
    .filter((e) => e.rounds >= 1)
    .sort((a, b) => b.net - a.net)
    .slice(0, 5)
    .map((e) => ({
      name: e.name,
      value: fmtMoney(e.net),
      tone: e.net > 0 ? ("win" as const) : e.net < 0 ? ("loss" as const) : undefined,
      meta: `${e.rounds} round${e.rounds === 1 ? "" : "s"}`
    }));
}

export function bestProjected(
  perfs: RoundPerf[],
  roundLabel: (id: string) => string
): RecordRow | null {
  const candidates = perfs.filter((p) => p.holesCount >= 9);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => projectGross18(a.gross, a.holesCount) - projectGross18(b.gross, b.holesCount));
  const p = candidates[0];
  return {
    name: p.display_name,
    value: `${projectGross18(p.gross, p.holesCount)}${p.holesCount < 18 ? " (proj.)" : ""}`,
    meta: roundLabel(p.round_id)
  };
}

export function fmtMoney(c: number): string {
  return (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);
}

export function roundLabelOf(rounds: Map<string, { date: string; course: string | null }>) {
  return (id: string): string => {
    const r = rounds.get(id);
    if (!r) return "";
    return `${r.course ?? "Course"} · ${r.date}`;
  };
}
