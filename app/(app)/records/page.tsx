import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Record Books — all-time bests for the user's group across every finalized round.
 *
 * Built directly from raw queries (not the leaderboards stat engine) because
 * each record is a single best round, not a player aggregate.
 */
export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/records");

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  if (!groups || groups.length === 0) redirect("/onboarding");
  const group = groups[0];

  const { data: rounds } = await sb
    .from("rounds")
    .select("id, date, holes, courses(name)")
    .eq("group_id", group.id)
    .eq("status", "finalized")
    .order("date", { ascending: true });

  const roundIds = (rounds ?? []).map((r: any) => r.id);
  const safeRoundIds = roundIds.length > 0 ? roundIds : ["00000000-0000-0000-0000-000000000000"];

  const [{ data: rps }, { data: scoreRows }, { data: settlements }, { data: roundGames }] = await Promise.all([
    sb
      .from("round_players")
      .select("id, round_id, player_id, course_handicap, playing_handicap, players(display_name)")
      .in("round_id", safeRoundIds),
    sb
      .from("scores")
      .select("round_player_id, hole_number, gross"),
    sb
      .from("settlements")
      .select("round_id, from_round_player_id, to_round_player_id, amount_cents")
      .in("round_id", safeRoundIds),
    sb
      .from("round_games")
      .select("round_id, game_type, name")
      .in("round_id", safeRoundIds)
  ]);

  const roundsById = new Map((rounds ?? []).map((r: any) => [r.id, r]));
  const rpById = new Map((rps ?? []).map((rp: any) => [rp.id, rp]));
  const rpToRound = new Map((rps ?? []).map((rp: any) => [rp.id, rp.round_id]));
  const rpToPlayer = new Map((rps ?? []).map((rp: any) => [rp.id, rp.player_id]));

  // For each round_player: aggregate gross, count birdies (relative to par —
  // we approximate par 4 for every hole because we don't have per-tee par
  // here; close enough for a record book).
  // TODO: refine with actual per-hole pars.
  type RoundPerf = {
    round_id: string;
    rp_id: string;
    player_id: string;
    display_name: string;
    gross: number;
    holesCount: number;
    par_played: number;
    birdies: number;
  };
  const perfs: RoundPerf[] = [];
  const grossByRp = new Map<string, { gross: number; holes: number }>();
  for (const s of (scoreRows as any[]) ?? []) {
    if (s.gross == null) continue;
    const rec = grossByRp.get(s.round_player_id) ?? { gross: 0, holes: 0 };
    rec.gross += s.gross;
    rec.holes += 1;
    grossByRp.set(s.round_player_id, rec);
  }
  for (const rp of (rps ?? []) as any[]) {
    const g = grossByRp.get(rp.id);
    if (!g || g.holes === 0) continue;
    perfs.push({
      round_id: rp.round_id,
      rp_id: rp.id,
      player_id: rp.player_id,
      display_name: rp.players?.display_name ?? "Player",
      gross: g.gross,
      holesCount: g.holes,
      par_played: 0, // computed below if needed
      birdies: 0
    });
  }

  // Money per (round, player)
  const moneyByRp = new Map<string, number>();
  for (const set of (settlements as any[]) ?? []) {
    moneyByRp.set(set.from_round_player_id, (moneyByRp.get(set.from_round_player_id) ?? 0) - set.amount_cents);
    moneyByRp.set(set.to_round_player_id, (moneyByRp.get(set.to_round_player_id) ?? 0) + set.amount_cents);
  }

  // Records: lowest gross (18-hole rounds only for fairness)
  const eighteenHole = perfs.filter((p) => {
    const r = roundsById.get(p.round_id) as any;
    return r?.holes === 18 && p.holesCount === 18;
  });
  const lowestGross = eighteenHole.slice().sort((a, b) => a.gross - b.gross).slice(0, 5);
  const highestGross = eighteenHole.slice().sort((a, b) => b.gross - a.gross).slice(0, 5);

  const biggestWins = perfs
    .map((p) => ({ ...p, money: moneyByRp.get(p.rp_id) ?? 0 }))
    .filter((p) => p.money > 0)
    .sort((a, b) => b.money - a.money)
    .slice(0, 5);
  const biggestLosses = perfs
    .map((p) => ({ ...p, money: moneyByRp.get(p.rp_id) ?? 0 }))
    .filter((p) => p.money < 0)
    .sort((a, b) => a.money - b.money)
    .slice(0, 5);

  // Most rounds played (per player)
  const roundsPerPlayer = new Map<string, { name: string; count: number }>();
  for (const rp of (rps ?? []) as any[]) {
    const e = roundsPerPlayer.get(rp.player_id) ?? { name: rp.players?.display_name ?? "Player", count: 0 };
    e.count += 1;
    roundsPerPlayer.set(rp.player_id, e);
  }
  const mostRoundsPlayed = [...roundsPerPlayer.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  // Lowest 9-hole gross (own category — different scale than 18s)
  const nineHole = perfs.filter((p) => {
    const r = roundsById.get(p.round_id) as any;
    return r?.holes === 9 && p.holesCount === 9;
  });
  const lowestGross9 = nineHole.slice().sort((a, b) => a.gross - b.gross).slice(0, 5);

  // Course records — best (lowest) gross by course, across all 18-hole rounds.
  // Group performances by course name; pick the lowest gross per course.
  const bestByCourse = new Map<string, RoundPerf & { course: string }>();
  for (const p of eighteenHole) {
    const r = roundsById.get(p.round_id) as any;
    const courseName = r?.courses?.name as string | undefined;
    if (!courseName) continue;
    const existing = bestByCourse.get(courseName);
    if (!existing || p.gross < existing.gross) {
      bestByCourse.set(courseName, { ...p, course: courseName });
    }
  }
  const courseRecords = [...bestByCourse.values()]
    .sort((a, b) => a.gross - b.gross)
    .slice(0, 8);

  // Best season net (sum of single-round nets across all rounds, top of leaderboard).
  const seasonNetByPlayer = new Map<string, { name: string; net: number; rounds: number }>();
  for (const rp of (rps ?? []) as any[]) {
    const e = seasonNetByPlayer.get(rp.player_id) ?? {
      name: rp.players?.display_name ?? "Player",
      net: 0,
      rounds: 0
    };
    e.net += moneyByRp.get(rp.id) ?? 0;
    e.rounds += 1;
    seasonNetByPlayer.set(rp.player_id, e);
  }
  const seasonNetTop = [...seasonNetByPlayer.values()]
    .filter((e) => e.rounds >= 1)
    .sort((a, b) => b.net - a.net)
    .slice(0, 5);

  const fmtMoney = (c: number) => (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="space-y-6">
      <header>
        <p className="h-eyebrow text-gold-400">{group.name}</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Record book</h1>
        <p className="text-xs text-cream-100/55 mt-1">
          All-time bests across {(rounds?.length ?? 0).toLocaleString()} finalized rounds.
          <span className="ml-3 text-gold-400">
            <Link href="/leaderboards">Season leaderboards →</Link>
          </span>
        </p>
      </header>

      {(rounds?.length ?? 0) === 0 ? (
        <div className="card p-8 text-center text-cream-100/65">
          No finalized rounds yet. Records open up once rounds are settled.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RecordCard
            title="🏆 Lowest gross (18 holes)"
            rows={lowestGross.map((p) => ({
              name: p.display_name,
              value: String(p.gross),
              meta: roundLabel(roundsById.get(p.round_id) as any)
            }))}
          />
          <RecordCard
            title="💀 Highest gross (18 holes)"
            rows={highestGross.map((p) => ({
              name: p.display_name,
              value: String(p.gross),
              meta: roundLabel(roundsById.get(p.round_id) as any)
            }))}
          />
          <RecordCard
            title="💰 Biggest single-round win"
            rows={biggestWins.map((p) => ({
              name: p.display_name,
              value: fmtMoney(p.money),
              tone: "win",
              meta: roundLabel(roundsById.get(p.round_id) as any)
            }))}
          />
          <RecordCard
            title="🩸 Biggest single-round loss"
            rows={biggestLosses.map((p) => ({
              name: p.display_name,
              value: fmtMoney(p.money),
              tone: "loss",
              meta: roundLabel(roundsById.get(p.round_id) as any)
            }))}
          />
          <RecordCard
            title="📅 Most rounds played"
            rows={mostRoundsPlayed.map(([_, e]) => ({
              name: e.name,
              value: String(e.count),
              meta: ""
            }))}
          />
          {lowestGross9.length > 0 && (
            <RecordCard
              title="🎯 Lowest gross (9 holes)"
              rows={lowestGross9.map((p) => ({
                name: p.display_name,
                value: String(p.gross),
                meta: roundLabel(roundsById.get(p.round_id) as any)
              }))}
            />
          )}
          {seasonNetTop.length > 0 && (
            <RecordCard
              title="👑 Season net (all rounds)"
              rows={seasonNetTop.map((e) => ({
                name: e.name,
                value: fmtMoney(e.net),
                tone: e.net > 0 ? "win" : e.net < 0 ? "loss" : undefined,
                meta: `${e.rounds} round${e.rounds === 1 ? "" : "s"}`
              }))}
            />
          )}
        </div>
      )}

      {/* Course records — one row per course played. */}
      {courseRecords.length > 0 && (
        <section className="space-y-2">
          <p className="h-eyebrow text-gold-400">Course records</p>
          <div className="card divide-y divide-cream-100/8">
            {courseRecords.map((c, i) => {
              const r = roundsById.get(c.round_id) as any;
              return (
                <div
                  key={i}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-serif text-base text-cream-50 truncate">
                      {c.course}
                    </div>
                    <div className="text-[11px] text-cream-100/55 truncate">
                      {c.display_name} · {r?.date ?? ""}
                    </div>
                  </div>
                  <span className="tabular-nums font-serif text-2xl text-gold-400">
                    {c.gross}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function roundLabel(r: any): string {
  if (!r) return "";
  return `${r.courses?.name ?? "Course"} · ${r.date}`;
}

function RecordCard({
  title,
  rows
}: {
  title: string;
  rows: Array<{ name: string; value: string; meta: string; tone?: "win" | "loss" }>;
}) {
  return (
    <div className="card p-4">
      <h2 className="font-serif text-lg text-cream-50 mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-cream-100/55 py-2">No records yet.</p>
      ) : (
        <ol className="divide-y divide-cream-100/8">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between py-2 gap-3">
              <span className="text-cream-100/45 text-xs tabular-nums w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-cream-50 truncate">{r.name}</div>
                {r.meta && <div className="text-[10px] text-cream-100/45 truncate">{r.meta}</div>}
              </div>
              <span
                className={`tabular-nums font-medium text-sm ${
                  r.tone === "win"
                    ? "text-emerald-300"
                    : r.tone === "loss"
                    ? "text-red-300"
                    : "text-cream-50"
                }`}
              >
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
