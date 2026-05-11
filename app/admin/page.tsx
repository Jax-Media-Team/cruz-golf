import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format-date";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";

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

  // Live rounds right now — the highest-leverage admin observability
  // surface. Includes spectator_token so we can deep-link straight to the
  // read-only leaderboard with the admin banner.
  const { data: liveRoundsList } = await sb
    .from("rounds")
    .select("id, date, spectator_token, group_id, course_id, courses(name), groups(name)")
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(20);

  // Recent destructive-op log — defensive fetch (table doesn't exist
  // until 0027 is applied; we silently skip if missing).
  let recentAuditLog: Array<{
    id: string;
    occurred_at: string;
    actor_profile_id: string | null;
    kind: string;
    target_id: string;
    target_table: string;
    detail: any;
  }> = [];
  try {
    const { data, error } = await sb
      .from("destructive_audit_log")
      .select("id, occurred_at, actor_profile_id, kind, target_id, target_table, detail")
      .order("occurred_at", { ascending: false })
      .limit(8);
    if (!error && data) recentAuditLog = data as any;
  } catch {
    /* table not yet present — admin tile silently hides */
  }

  // Pending presses across the platform — high-leverage troubleshooting
  // surface. Anything sitting >12h is flagged for attention (UI-side
  // expiry is 24h; >12h means it's getting stale). Defensive against
  // pre-0035 envs where round_presses doesn't exist.
  let pendingPresses: Array<{
    id: string;
    round_id: string;
    segment_label: string;
    stake_cents: number;
    opened_at: string;
    course_name: string | null;
    group_name: string | null;
    age_hours: number;
  }> = [];
  try {
    const { data } = await sb
      .from("round_presses")
      .select(
        "id, round_id, segment_label, stake_cents, opened_at, rounds(courses(name), groups(name))"
      )
      .eq("status", "pending")
      .order("opened_at", { ascending: true })
      .limit(20);
    pendingPresses = ((data as any[]) ?? []).map((p) => {
      const ageMs = Date.now() - new Date(p.opened_at).getTime();
      return {
        id: p.id,
        round_id: p.round_id,
        segment_label: p.segment_label,
        stake_cents: p.stake_cents,
        opened_at: p.opened_at,
        course_name: p.rounds?.courses?.name ?? null,
        group_name: p.rounds?.groups?.name ?? null,
        age_hours: Math.floor(ageMs / 3_600_000)
      };
    });
  } catch {
    /* pre-0035 — table missing */
  }

  // Stale live rounds — rounds in status="live" with no score write in
  // the last 24h. These are the abandoned-round cases that clutter the
  // admin "live" view over time. We surface them as a "needs attention"
  // list so an admin can archive (soft-delete) or finalize them,
  // depending on whether scoring actually happened. CLAUDE.md is
  // explicit: NO time-driven auto-transitions. Admin acts manually.
  type StaleRound = {
    id: string;
    date: string;
    group_id: string | null;
    course_name: string | null;
    group_name: string | null;
    last_score_at: string | null;
    hours_since_last_score: number | null;
    total_scores: number;
  };
  let staleRounds: StaleRound[] = [];
  try {
    const { data: liveRows } = await sb
      .from("rounds")
      .select(
        "id, date, group_id, course_id, courses(name), groups(name)"
      )
      .eq("status", "live")
      .is("deleted_at", null)
      .order("date", { ascending: true });
    const liveIdMap = new Map<string, any>();
    for (const r of (liveRows as any[]) ?? []) liveIdMap.set(r.id, r);
    if (liveIdMap.size > 0) {
      // Get the round_player_ids per live round so we can ask scores for
      // each. We then aggregate max(updated_at) per round.
      const { data: rpRows } = await sb
        .from("round_players")
        .select("id, round_id")
        .in("round_id", [...liveIdMap.keys()]);
      const rpToRound = new Map<string, string>();
      for (const rp of (rpRows as any[]) ?? []) rpToRound.set(rp.id, rp.round_id);
      const allRpIds = [...rpToRound.keys()];
      const scoresByRound = new Map<
        string,
        { count: number; max_updated_at: string | null }
      >();
      if (allRpIds.length > 0) {
        const { data: scoreRows } = await sb
          .from("scores")
          .select("round_player_id, updated_at")
          .in("round_player_id", allRpIds);
        for (const s of (scoreRows as any[]) ?? []) {
          const rid = rpToRound.get(s.round_player_id);
          if (!rid) continue;
          const cur = scoresByRound.get(rid) ?? {
            count: 0,
            max_updated_at: null
          };
          cur.count += 1;
          if (
            !cur.max_updated_at ||
            s.updated_at > cur.max_updated_at
          ) {
            cur.max_updated_at = s.updated_at;
          }
          scoresByRound.set(rid, cur);
        }
      }
      const now = Date.now();
      const STALE_HOURS = 24;
      for (const [rid, r] of liveIdMap.entries()) {
        const stats = scoresByRound.get(rid) ?? {
          count: 0,
          max_updated_at: null
        };
        const ageHours = stats.max_updated_at
          ? (now - new Date(stats.max_updated_at).getTime()) / 3_600_000
          : (now - new Date(r.date).getTime()) / 3_600_000;
        if (ageHours < STALE_HOURS) continue;
        staleRounds.push({
          id: rid,
          date: r.date,
          group_id: r.group_id,
          course_name: r.courses?.name ?? null,
          group_name: r.groups?.name ?? null,
          last_score_at: stats.max_updated_at,
          hours_since_last_score: Math.floor(ageHours),
          total_scores: stats.count
        });
      }
      // Show the oldest first.
      staleRounds.sort(
        (a, b) =>
          (b.hours_since_last_score ?? 0) - (a.hours_since_last_score ?? 0)
      );
    }
  } catch {
    /* fall through — panel just hides */
  }

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

  // Rounds by month — last 6 calendar months, including zero months so
  // the chart stays a 6-bar timeline instead of collapsing to one tall
  // bar when only the current month has data. Each entry is
  // [yyyy-mm, count, shortLabel] where shortLabel is "May" / "May '26"
  // — readable instead of the raw "05" that used to ship.
  const monthCounts = new Map<string, number>();
  for (const r of (allRoundsRes.data as any[]) ?? []) {
    const m = r.date?.slice(0, 7);
    if (m) monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
  }
  const MONTH_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const now = new Date();
  const recentMonths: Array<{ key: string; count: number; label: string }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label =
      i === 0
        ? `${MONTH_SHORT[d.getMonth()]} (this mo)`
        : MONTH_SHORT[d.getMonth()];
    recentMonths.push({ key, count: monthCounts.get(key) ?? 0, label });
  }
  const totalRecent = recentMonths.reduce((s, r) => s + r.count, 0);

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

      {/* Live-rounds spectator strip — only renders when something's
          actually in progress. One tap from /admin to a read-only
          leaderboard with the admin banner. */}
      {(liveRoundsList?.length ?? 0) > 0 && (
        <section className="card p-4 border border-emerald-400/30 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">
              🟢 Live right now ({liveRoundsList?.length ?? 0})
            </h2>
            <Link href="/admin/rounds?status=live" className="text-xs text-gold-400 underline">
              All live →
            </Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {(liveRoundsList ?? []).map((r: any) => (
              <li
                key={r.id}
                className="py-2 flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/rounds/${r.id}`}
                    className="text-cream-50 hover:underline truncate block"
                  >
                    {r.courses?.name ?? "Course"}
                    <span className="text-cream-100/55 text-xs ml-2">· {r.date}</span>
                  </Link>
                  <div className="text-[11px] text-cream-100/55 truncate">
                    {r.groups?.name ?? "Group"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.spectator_token && (
                    <Link
                      href={`/rounds/${r.id}/leaderboard?token=${r.spectator_token}&adminMode=1`}
                      className="btn-secondary text-xs"
                      title="Read-only live leaderboard with admin banner"
                    >
                      👀 Spectate
                    </Link>
                  )}
                  <Link
                    href={`/admin/rounds/${r.id}`}
                    className="btn-ghost text-xs"
                  >
                    Inspect →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pending presses across the platform — anything older than 12h
          is highlighted amber, anything older than 20h is highlighted
          red so they're easy to spot before auto-expiry. */}
      {pendingPresses.length > 0 && (
        <section className="card p-4 border border-amber-400/30 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">
              Pending presses ({pendingPresses.length})
            </h2>
            <Link href="/admin/audit?kind=press.open" className="text-xs text-gold-400 underline">
              Audit history →
            </Link>
          </div>
          <p className="text-[11px] text-cream-100/55">
            Pending more than 24h auto-expires on the next action. Use this list
            to nudge groups whose presses are sitting unanswered.
          </p>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {pendingPresses.map((p) => {
              const ageColor =
                p.age_hours >= 20
                  ? "text-red-300"
                  : p.age_hours >= 12
                  ? "text-amber-300"
                  : "text-cream-100/65";
              return (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/rounds/${p.round_id}`}
                      className="text-cream-50 hover:underline truncate block"
                    >
                      {p.course_name ?? "Course"}
                      <span className="text-cream-100/55 text-xs ml-2">
                        · {p.segment_label} · ${(p.stake_cents / 100).toFixed(0)}
                      </span>
                    </Link>
                    <div className="text-[11px] text-cream-100/55 truncate">
                      {p.group_name ?? "Group"}
                    </div>
                  </div>
                  <div className={`text-xs tabular-nums ${ageColor} shrink-0`}>
                    {p.age_hours === 0 ? "<1h" : `${p.age_hours}h ago`}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Stale live rounds — status="live" with no score writes in 24h+.
          These are abandoned-round candidates. We do NOT auto-transition
          them (per CLAUDE.md: no time-driven lifecycle). Admin triages:
          - Has scores → likely real round forgotten; finalize or move
            to pending so it's out of the live bucket.
          - No scores → likely a test draft that went live by accident;
            archive (soft-delete) — kept in audit log, gone from active
            browsing.
          24h threshold matches a typical "didn't finish yesterday's
          round" pattern.  */}
      {staleRounds.length > 0 && (
        <section className="card p-4 border border-amber-400/30 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-serif text-lg text-cream-50">
              Stale live rounds ({staleRounds.length})
            </h2>
            <Link
              href="/admin/rounds?status=live"
              className="text-xs text-gold-400 underline"
            >
              All live →
            </Link>
          </div>
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Rounds in &quot;live&quot; with no score writes for 24h+. Admin
            should triage: rounds with scores → finalize or mark pending;
            rounds with no scores → archive (test drafts that went live).
            Auto-transitions are deliberately disabled (see CLAUDE.md).
          </p>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {staleRounds.slice(0, 10).map((r) => {
              const tone =
                (r.hours_since_last_score ?? 0) >= 72
                  ? "text-red-300"
                  : (r.hours_since_last_score ?? 0) >= 48
                  ? "text-amber-300"
                  : "text-cream-100/65";
              return (
                <li
                  key={r.id}
                  className="py-2 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/rounds/${r.id}`}
                      className="text-cream-50 hover:underline truncate block"
                    >
                      {r.course_name ?? "Course"}
                      <span className="text-cream-100/55 text-xs ml-2">
                        · {r.date} · {r.total_scores} score
                        {r.total_scores === 1 ? "" : "s"}
                      </span>
                    </Link>
                    <div className="text-[11px] text-cream-100/55 truncate">
                      {r.group_name ?? "Group"}
                    </div>
                  </div>
                  <div
                    className={`text-xs tabular-nums ${tone} shrink-0`}
                  >
                    {r.hours_since_last_score === null
                      ? "—"
                      : r.hours_since_last_score >= 24
                      ? `${Math.floor(r.hours_since_last_score / 24)}d idle`
                      : `${r.hours_since_last_score}h idle`}
                  </div>
                </li>
              );
            })}
          </ul>
          {staleRounds.length > 10 && (
            <p className="text-[11px] text-cream-100/55 pt-1">
              + {staleRounds.length - 10} more — view all live rounds for
              full list.
            </p>
          )}
        </section>
      )}

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
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <h2 className="font-serif text-lg text-cream-50">
            Rounds by month
          </h2>
          <p className="text-[11px] text-cream-100/55 tabular-nums">
            {totalRecent} round{totalRecent === 1 ? "" : "s"} · last 6 months
          </p>
        </div>
        {totalRecent === 0 ? (
          <p className="text-xs text-cream-100/55">
            No rounds finalized in the last 6 months.
          </p>
        ) : (
          <div className="flex items-end gap-3 h-28">
            {recentMonths.map(({ key, count, label }) => {
              const max = Math.max(
                1,
                ...recentMonths.map((r) => r.count)
              );
              // Zero months show a 4px stub line so the timeline reads
              // as continuous instead of "no data". Bars scale to
              // 80px max so a single big month doesn't dominate.
              const h = count === 0 ? 4 : Math.max(10, (count / max) * 80);
              const isCurrent = label.includes("this mo");
              return (
                <div
                  key={key}
                  className="flex-1 flex flex-col items-center gap-1 min-w-0"
                  title={`${count} round${count === 1 ? "" : "s"} in ${label.replace(" (this mo)", "")}`}
                >
                  <div
                    className={`text-[10px] tabular-nums ${
                      count > 0
                        ? "text-cream-100/85"
                        : "text-cream-100/30"
                    }`}
                  >
                    {count}
                  </div>
                  <div
                    className={`w-full rounded ${
                      count === 0
                        ? "bg-cream-100/8"
                        : isCurrent
                        ? "bg-gold-500"
                        : "bg-gold-500/40"
                    }`}
                    style={{ height: `${h}px` }}
                  />
                  <div
                    className={`text-[10px] truncate w-full text-center ${
                      isCurrent
                        ? "text-gold-400 font-medium"
                        : "text-cream-100/55"
                    }`}
                  >
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {recentAuditLog.length > 0 && (
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">Recent admin activity</h2>
            <Link href="/admin/audit" className="text-xs text-gold-400 underline">
              View all →
            </Link>
          </div>
          <p className="text-[11px] text-cream-100/55">
            Append-only audit trail of destructive ops (archive, restore,
            finalize, verify, lifecycle transitions). Read-only.
          </p>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {recentAuditLog.map((entry) => (
              <li
                key={entry.id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <span className="text-cream-50 truncate font-mono text-xs">
                  {entry.kind}
                </span>
                <span className="text-[11px] text-cream-100/55 tabular-nums shrink-0">
                  {new Date(entry.occurred_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  {(() => {
                    const pill = statusPillFor(r.status as RoundStatus);
                    return <span className={`${pill.className} text-xs`}>{pill.label}</span>;
                  })()}
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
