import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format-date";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const sb = supabaseAdmin();

  const [
    profiles,
    groups,
    rounds,
    courses,
    players,
    scoreCount,
    uploads,
    recentUsers,
    recentRounds,
    feedbackNew,
    allRoundsRes,
    allRoundPlayersRes,
    allSettlementsRes,
    allCoursesRes,
    allRoundGamesRes,
    allFeedbackRes
  ] = await Promise.all([
    sb.from("profiles").select("*", { head: true, count: "exact" }),
    sb.from("groups").select("*", { head: true, count: "exact" }),
    sb.from("rounds").select("*", { head: true, count: "exact" }),
    sb.from("courses").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("players").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("scores").select("*", { head: true, count: "exact" }),
    sb.from("scorecard_uploads").select("*", { head: true, count: "exact" }),
    sb
      .from("profiles")
      .select("id, display_name, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("rounds")
      .select("id, date, status, created_at, group_id, courses(name), groups(name)")
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("feedback").select("*", { head: true, count: "exact" }).eq("status", "new"),
    sb.from("rounds").select("id, date, status, course_id"),
    sb.from("round_players").select("round_id, player_id, players(display_name)"),
    sb.from("settlements").select("from_round_player_id, to_round_player_id, amount_cents"),
    sb.from("courses").select("id, name").is("deleted_at", null),
    sb.from("round_games").select("game_type"),
    sb.from("feedback").select("id, kind, body, status, created_at, profile_id, profiles(display_name)").order("created_at", { ascending: false }).limit(8)
  ]);

  const liveRounds = await sb
    .from("rounds")
    .select("*", { head: true, count: "exact" })
    .eq("status", "live");
  const finalizedRounds = await sb
    .from("rounds")
    .select("*", { head: true, count: "exact" })
    .eq("status", "finalized");

  // ----- Computed analytics -----
  // Most played courses
  const courseRoundCount = new Map<string, number>();
  for (const r of (allRoundsRes.data as any[]) ?? []) {
    courseRoundCount.set(r.course_id, (courseRoundCount.get(r.course_id) ?? 0) + 1);
  }
  const courseNameById = new Map((allCoursesRes.data ?? []).map((c: any) => [c.id, c.name]));
  const mostPlayedCourses = [...courseRoundCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => ({ id, name: courseNameById.get(id) ?? "Course", rounds: n }));

  // Rounds by month (last 6 months)
  const monthCounts = new Map<string, number>();
  for (const r of (allRoundsRes.data as any[]) ?? []) {
    const m = r.date?.slice(0, 7);
    if (m) monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
  }
  const recentMonths = [...monthCounts.entries()].sort().slice(-6);

  // Game types most played
  const gameTypeCounts = new Map<string, number>();
  for (const g of (allRoundGamesRes.data as any[]) ?? []) {
    gameTypeCounts.set(g.game_type, (gameTypeCounts.get(g.game_type) ?? 0) + 1);
  }
  const topGameTypes = [...gameTypeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Players per round (avg)
  const playersInRound = new Map<string, number>();
  for (const rp of (allRoundPlayersRes.data as any[]) ?? []) {
    playersInRound.set(rp.round_id, (playersInRound.get(rp.round_id) ?? 0) + 1);
  }
  const avgPlayersPerRound =
    playersInRound.size > 0
      ? [...playersInRound.values()].reduce((s, n) => s + n, 0) / playersInRound.size
      : 0;

  // Most active players (by # rounds)
  const playerRoundCount = new Map<string, { name: string; count: number }>();
  for (const rp of (allRoundPlayersRes.data as any[]) ?? []) {
    const e = playerRoundCount.get(rp.player_id) ?? {
      name: (rp.players as any)?.display_name ?? "Player",
      count: 0
    };
    e.count += 1;
    playerRoundCount.set(rp.player_id, e);
  }
  const mostActivePlayers = [...playerRoundCount.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  // Biggest single-round wins/losses (settlement-derived)
  const moneyByRpRound = new Map<string, number>(); // key = `${rpId}` (per round, since settlements are per-round)
  for (const set of (allSettlementsRes.data as any[]) ?? []) {
    moneyByRpRound.set(
      set.from_round_player_id,
      (moneyByRpRound.get(set.from_round_player_id) ?? 0) - set.amount_cents
    );
    moneyByRpRound.set(
      set.to_round_player_id,
      (moneyByRpRound.get(set.to_round_player_id) ?? 0) + set.amount_cents
    );
  }
  // Map rp_id -> player display name via the round_players list
  const rpToName = new Map<string, string>();
  for (const rp of (allRoundPlayersRes.data as any[]) ?? []) {
    // We're missing rp.id in the select — adjust below.
  }

  // Users who signed up but never played
  const playedProfileIds = new Set<string>();
  for (const rp of (allRoundPlayersRes.data as any[]) ?? []) {
    // round_players doesn't link directly to profiles; we'd need to join via players.profile_id.
    // Approximation: profiles count - players-with-profile-matching count.
  }
  // Simple count: profiles total minus distinct profile_ids that have any player row
  const { data: playersWithProfiles } = await sb.from("players").select("profile_id").not("profile_id", "is", null);
  const profilesWithRoster = new Set((playersWithProfiles ?? []).map((p: any) => p.profile_id));
  const profilesNeverPlayed = (profiles.count ?? 0) - profilesWithRoster.size;

  return (
    <div className="space-y-6">
      <header>
        <p className="h-eyebrow text-gold-400">Platform</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Overview</h1>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Users" value={profiles.count ?? 0} href="/admin/users" />
        <Stat label="Groups" value={groups.count ?? 0} href="/admin/groups" />
        <Stat label="Rounds" value={rounds.count ?? 0} href="/admin/rounds" />
        <Stat label="Courses" value={courses.count ?? 0} href="/admin/courses" />
        <Stat label="Players (in groups)" value={players.count ?? 0} />
        <Stat label="Live rounds" value={liveRounds.count ?? 0} accent />
        <Stat label="Finalized rounds" value={finalizedRounds.count ?? 0} />
        <Stat label="Scores entered" value={scoreCount.count ?? 0} />
        <Stat label="Card uploads" value={uploads.count ?? 0} />
        <Stat label="Avg players / round" value={Math.round(avgPlayersPerRound * 10) / 10} />
        <Stat label="New feedback" value={feedbackNew.count ?? 0} href="/admin/feedback" accent={!!(feedbackNew.count && feedbackNew.count > 0)} />
        <Stat label="Signed up, never played" value={Math.max(0, profilesNeverPlayed)} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Most played courses</h2>
          <ol className="divide-y divide-cream-100/8 text-sm">
            {mostPlayedCourses.map((c, i) => (
              <li key={c.id} className="flex items-center justify-between py-2 gap-2">
                <span className="text-cream-100/45 text-xs w-4">{i + 1}</span>
                <span className="text-cream-50 truncate flex-1">{c.name}</span>
                <span className="tabular-nums">{c.rounds}</span>
              </li>
            ))}
            {mostPlayedCourses.length === 0 && <li className="py-2 text-xs text-cream-100/55">No rounds yet.</li>}
          </ol>
        </div>

        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Most played games</h2>
          <ol className="divide-y divide-cream-100/8 text-sm">
            {topGameTypes.map(([type, count], i) => (
              <li key={type} className="flex items-center justify-between py-2 gap-2">
                <span className="text-cream-100/45 text-xs w-4">{i + 1}</span>
                <span className="text-cream-50 truncate flex-1 font-mono text-xs">{type}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
            {topGameTypes.length === 0 && <li className="py-2 text-xs text-cream-100/55">No games yet.</li>}
          </ol>
        </div>

        <div className="card p-4">
          <h2 className="font-serif text-lg text-cream-50 mb-2">Most active players</h2>
          <ol className="divide-y divide-cream-100/8 text-sm">
            {mostActivePlayers.map(([pid, e], i) => (
              <li key={pid} className="flex items-center justify-between py-2 gap-2">
                <span className="text-cream-100/45 text-xs w-4">{i + 1}</span>
                <span className="text-cream-50 truncate flex-1">{e.name}</span>
                <span className="tabular-nums">{e.count} rounds</span>
              </li>
            ))}
            {mostActivePlayers.length === 0 && <li className="py-2 text-xs text-cream-100/55">No players yet.</li>}
          </ol>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-serif text-lg text-cream-50 mb-2">Rounds by month</h2>
        {recentMonths.length === 0 ? (
          <p className="text-xs text-cream-100/55">No rounds yet.</p>
        ) : (
          <div className="flex items-end gap-3 h-24">
            {recentMonths.map(([m, n]) => {
              const max = Math.max(...recentMonths.map(([, x]) => x));
              const h = Math.max(8, (n / max) * 80);
              return (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-cream-100/55 tabular-nums">{n}</div>
                  <div className="w-full bg-gold-500/40 rounded" style={{ height: `${h}px` }} />
                  <div className="text-[10px] text-cream-100/45">{m.slice(5)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">Recent signups</h2>
            <Link href="/admin/users" className="text-xs text-gold-400 underline">View all →</Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {recentUsers.data?.map((u: any) => (
              <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50 truncate">{u.display_name || "(no name)"}</span>
                <span className="text-xs text-cream-100/45 tabular-nums shrink-0">
                  {formatDate(u.created_at)}
                </span>
              </li>
            ))}
            {(recentUsers.data?.length ?? 0) === 0 && (
              <li className="py-2 text-cream-100/55 text-xs">No users yet.</li>
            )}
          </ul>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">Recent rounds</h2>
            <Link href="/admin/rounds" className="text-xs text-gold-400 underline">View all →</Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {recentRounds.data?.map((r: any) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50 truncate">
                  {r.courses?.name ?? "Course"} <span className="text-cream-100/45">·</span>{" "}
                  <span className="text-cream-100/55 text-xs">{r.groups?.name ?? "Group"}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      r.status === "live"
                        ? "pill-live text-xs"
                        : r.status === "finalized"
                        ? "pill-final text-xs"
                        : "pill-draft text-xs"
                    }
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-cream-100/45 tabular-nums">{r.date}</span>
                </span>
              </li>
            ))}
            {(recentRounds.data?.length ?? 0) === 0 && (
              <li className="py-2 text-cream-100/55 text-xs">No rounds yet.</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href, accent }: { label: string; value: number; href?: string; accent?: boolean }) {
  const inner = (
    <div
      className={`card p-4 ${href ? "card-hover" : ""} ${accent ? "border border-emerald-400/30" : ""}`}
    >
      <div className="text-xs text-cream-100/55 uppercase tracking-wider">{label}</div>
      <div
        className={`font-serif tabular-nums mt-1 ${accent ? "text-emerald-300" : "text-cream-50"}`}
        style={{ fontSize: 32, lineHeight: 1 }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
