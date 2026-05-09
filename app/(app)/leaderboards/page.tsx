import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import {
  buildLeaderboards,
  buildPlayerStats,
  type StatRound,
  type StatRoundPlayer,
  type StatScore,
  type StatSettlement
} from "@/lib/leaderboards";

export const dynamic = "force-dynamic";

export default async function LeaderboardsPage() {
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/leaderboards");

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  if (!groups || groups.length === 0) redirect("/onboarding");
  const group = groups[0];

  // Pull all finalized rounds for the group + scores + settlements.
  const { data: rounds } = await sb
    .from("rounds")
    .select("id, date, status, holes, courses(name)")
    .eq("group_id", group.id)
    .eq("status", "finalized")
    .order("date", { ascending: true });

  const roundIds = (rounds ?? []).map((r: any) => r.id);
  const safeIds = roundIds.length > 0 ? roundIds : ["00000000-0000-0000-0000-000000000000"];

  const [{ data: rps }, { data: scores }, { data: settlements }, { data: courseHoles }] = await Promise.all([
    sb
      .from("round_players")
      .select("id, round_id, player_id, team_id, course_handicap, playing_handicap, players(display_name), course_tees(course_holes(hole_number, par, stroke_index))")
      .in("round_id", safeIds),
    sb
      .from("scores")
      .select("round_player_id, hole_number, gross")
      .in("round_player_id", safeIds.length > 0 ? [] : []),
    sb
      .from("settlements")
      .select("round_id, from_round_player_id, to_round_player_id, amount_cents")
      .in("round_id", safeIds),
    sb.from("course_holes").select("tee_id, hole_number, par, stroke_index")
  ]);

  // Pull scores by round_player_id (separate query because we need rp ids first)
  const rpIds = (rps ?? []).map((rp: any) => rp.id);
  const safeRpIds = rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"];
  const { data: scoreRows } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", safeRpIds);

  // Build a (round_id, hole_number) -> par map via course_holes (per tee).
  // Each round_player has a tee_id with its own holes; in our data model par
  // is shared across tees, so any tee on the round works.
  const parByRoundHole = new Map<string, number>();
  for (const rp of (rps as any[]) ?? []) {
    const holes = rp.course_tees?.course_holes ?? [];
    for (const h of holes) {
      parByRoundHole.set(`${rp.round_id}:${h.hole_number}`, h.par);
    }
  }

  // Adapt to our pure stat-engine inputs.
  const statRounds: StatRound[] = (rounds ?? []).map((r: any) => ({
    round_id: r.id,
    round_date: r.date,
    course_name: r.courses?.name ?? null,
    status: r.status,
    group_id: group.id,
    holes: r.holes
  }));
  const statRps: StatRoundPlayer[] = (rps ?? []).map((rp: any) => ({
    round_player_id: rp.id,
    round_id: rp.round_id,
    player_id: rp.player_id,
    display_name: rp.players?.display_name ?? "Player",
    team_id: rp.team_id,
    course_handicap: rp.course_handicap ?? 0,
    playing_handicap: rp.playing_handicap ?? 0
  }));
  const rpToRound = new Map(statRps.map((rp) => [rp.round_player_id, rp.round_id]));
  const statScores: StatScore[] = (scoreRows ?? []).map((s: any) => {
    const roundId = rpToRound.get(s.round_player_id) ?? "";
    const par = parByRoundHole.get(`${roundId}:${s.hole_number}`) ?? 4;
    return {
      round_player_id: s.round_player_id,
      hole_number: s.hole_number,
      par,
      gross: s.gross,
      strokes_received: 0
    };
  });
  const statSettlements: StatSettlement[] = (settlements ?? []).map((s: any) => ({
    round_id: s.round_id,
    from_round_player_id: s.from_round_player_id,
    to_round_player_id: s.to_round_player_id,
    amount_cents: s.amount_cents
  }));

  const stats = buildPlayerStats({
    rounds: statRounds,
    roundPlayers: statRps,
    scores: statScores,
    settlements: statSettlements
  });
  const boards = buildLeaderboards(stats);

  return (
    <div className="space-y-6">
      <header>
        <p className="h-eyebrow text-gold-400">{group.name}</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Leaderboards</h1>
        <p className="text-xs text-cream-100/55 mt-1">
          Across {(rounds?.length ?? 0).toLocaleString()} finalized rounds.
        </p>
      </header>

      {(rounds?.length ?? 0) === 0 ? (
        <div className="card p-8 text-center text-cream-100/65">
          No finalized rounds yet. Finish a round to start populating leaderboards.
          <div className="mt-3">
            <Link href="/dashboard" className="text-gold-400 underline">
              Back to dashboard →
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Board
            title="💰 Money"
            subtitle="Net winnings across all settled rounds"
            rows={boards.money}
            valueFmt={(v) => fmtMoney(v)}
            valueTone={(v) => (v > 0 ? "text-emerald-300" : v < 0 ? "text-red-300" : "text-cream-100/65")}
          />
          <Board
            title="🐦 Birdies"
            subtitle="Total birdies + per-round average"
            rows={boards.birdies}
            valueFmt={(v) => v.toString()}
          />
          <Board
            title="🔥 Hot streak"
            subtitle="Consecutive winning rounds (recency)"
            rows={boards.hot}
            valueFmt={(v) => (v > 0 ? `${v}🔥` : "—")}
          />
          <Board
            title="🏆 Best round"
            subtitle="Lowest gross score (18-hole equivalent)"
            rows={boards.best_round}
            valueFmt={(v) => v.toString()}
          />
        </div>
      )}
    </div>
  );
}

function Board({
  title,
  subtitle,
  rows,
  valueFmt,
  valueTone
}: {
  title: string;
  subtitle: string;
  rows: { player_id: string; display_name: string; value: number; meta?: string }[];
  valueFmt: (v: number) => string;
  valueTone?: (v: number) => string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif text-lg text-cream-50">{title}</h2>
      </div>
      <p className="text-[11px] text-cream-100/55 mb-3">{subtitle}</p>
      <ol className="divide-y divide-cream-100/8">
        {rows.slice(0, 8).map((r, i) => (
          <li key={r.player_id} className="flex items-center justify-between py-2 gap-3">
            <span className="text-cream-100/45 text-xs tabular-nums w-5">{i + 1}</span>
            <Link
              href={`/players/${r.player_id}/stats`}
              className="flex-1 min-w-0 text-cream-50 truncate hover:underline"
            >
              {r.display_name}
            </Link>
            {r.meta && <span className="text-[10px] text-cream-100/45 hidden sm:inline">{r.meta}</span>}
            <span
              className={`tabular-nums font-medium text-sm ${valueTone ? valueTone(r.value) : "text-cream-50"}`}
            >
              {valueFmt(r.value)}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-xs text-cream-100/55">No data yet.</li>}
      </ol>
    </div>
  );
}

function fmtMoney(cents: number): string {
  const sign = cents >= 0 ? "+" : "−";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
