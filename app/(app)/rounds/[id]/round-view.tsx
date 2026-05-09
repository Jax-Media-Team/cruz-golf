"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { settleGame } from "@/lib/games";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import type { CourseHole, RoundGame, RoundPlayer, Score } from "@/lib/types";

type RP = any;

export function RoundView({
  roundId,
  rps,
  initialScores,
  games
}: {
  roundId: string;
  rps: RP[];
  initialScores: Score[];
  games: any[];
}) {
  const [tab, setTab] = useState<LeaderboardTab>("net");
  const [scores, setScores] = useState<Score[]>(initialScores);
  const router = useRouter();

  const players: RoundPlayer[] = useMemo(
    () =>
      rps.map((r: any) => ({
        id: r.id,
        player_id: r.player_id,
        display_name: r.players?.display_name ?? "Player",
        tee_id: r.tee_id,
        tee: {
          id: r.course_tees?.id ?? r.tee_id,
          name: r.course_tees?.name ?? "",
          rating: r.course_tees?.rating ?? 72,
          slope: r.course_tees?.slope ?? 113,
          par: r.course_tees?.par ?? 72,
          holes: (r.course_tees?.course_holes ?? [])
            .slice()
            .sort((a: CourseHole, b: CourseHole) => a.hole_number - b.hole_number)
        },
        handicap_index_used: 0,
        course_handicap: r.course_handicap,
        playing_handicap: r.playing_handicap,
        team_id: r.team_id
      })),
    [rps]
  );

  const holes: CourseHole[] = useMemo(() => players[0]?.tee?.holes ?? [], [players]);

  // Realtime subscription with reconnect-safe refetch.
  // The Supabase SDK auto-reconnects the socket, but events emitted while
  // disconnected are lost — so on every (re)subscribe we refetch the round's
  // scores from the DB to catch up. We also keep a 60s safety-net refetch.
  useEffect(() => {
    const sb = supabaseBrowser();
    const rpIds = new Set(players.map((p) => p.id));
    if (rpIds.size === 0) return;

    let cancelled = false;

    async function refetchScores() {
      const { data } = await sb
        .from("scores")
        .select("round_player_id, hole_number, gross")
        .in("round_player_id", Array.from(rpIds));
      if (cancelled || !data) return;
      setScores(data as Score[]);
    }

    const channel = sb
      .channel(`round-${roundId}-scores`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          if (!rpIds.has(row.round_player_id)) return;
          setScores((prev) => {
            const idx = prev.findIndex(
              (s) => s.round_player_id === row.round_player_id && s.hole_number === row.hole_number
            );
            const next =
              idx >= 0
                ? [...prev]
                : prev.concat([{ round_player_id: row.round_player_id, hole_number: row.hole_number, gross: row.gross ?? null }]);
            if (idx >= 0) next[idx] = { ...next[idx], gross: row.gross ?? null };
            return next;
          });
        }
      )
      .subscribe((status) => {
        // After a (re)subscribe, refetch to catch any events missed while disconnected.
        if (status === "SUBSCRIBED") refetchScores();
      });

    // Safety-net refetch every 60s in case Realtime events are silently dropped.
    const interval = setInterval(refetchScores, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      sb.removeChannel(channel);
    };
  }, [roundId, players]);

  const sheets = players.map((p) => buildPlayerSheet(p, scores, holes));
  const mode = tab === "gross" ? "gross" : "net";
  const board = leaderboard(sheets, mode);

  const courseLabel = `${players[0]?.tee?.name ? `${players[0].tee.name} · ` : ""}${holes.length} holes`;

  return (
    <Leaderboard
      courseName={courseLabel}
      status="live"
      rows={board}
      tab={tab}
      onTabChange={setTab}
      onPlayerClick={(rpId) => router.push(`/rounds/${roundId}/score?rp=${rpId}`)}
      alternateContent={
        tab === "skins" ? (
          <SkinsPanel games={games} players={players} scores={scores} holes={holes} />
        ) : tab === "team" ? (
          <TeamPanel games={games} players={players} scores={scores} holes={holes} />
        ) : tab === "bets" ? (
          <BetsPanel games={games} players={players} scores={scores} holes={holes} />
        ) : null
      }
    />
  );
}

function SkinsPanel({
  games,
  players,
  scores,
  holes
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
}) {
  const skinsGames = games.filter((g) => String(g.game_type).startsWith("skins"));
  if (skinsGames.length === 0)
    return <div className="text-slate-500 text-sm py-8 text-center">No skins game configured.</div>;

  return (
    <div className="space-y-4">
      {skinsGames.map((g) => {
        const out = settleGame({
          game: g as RoundGame,
          players,
          scores,
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }
        });
        return (
          <div key={g.id} className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 font-serif text-lg text-slate-900">
              {g.name}
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {out.highlights.length === 0 && (
                <li className="px-4 py-3 text-slate-500">No skins awarded yet.</li>
              )}
              {out.highlights.map((h, i) => (
                <li key={i} className="px-4 py-3 flex items-center justify-between">
                  <span className="text-slate-600">Hole {h.hole}</span>
                  <span className="text-slate-900 font-medium">{h.label}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TeamPanel({
  games,
  players,
  scores,
  holes
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
}) {
  const teamGames = games.filter((g) =>
    ["best_ball_gross", "best_ball_net", "aggregate_gross", "aggregate_net", "six_six_six"].includes(String(g.game_type))
  );
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));
  if (teamGames.length === 0)
    return <div className="text-slate-500 text-sm py-8 text-center">No team game configured.</div>;

  const fmt = (c: number) => (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="space-y-4">
      {teamGames.map((g) => {
        const out = settleGame({
          game: g as RoundGame,
          players,
          scores,
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }
        });
        const rows = [...out.perPlayer.entries()].sort((a, b) => b[1].delta_cents - a[1].delta_cents);
        return (
          <div key={g.id} className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 font-serif text-lg text-slate-900">
              {g.name}
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map(([pid, v]) => (
                <li key={pid} className="px-4 py-3 flex items-center justify-between">
                  <span className="text-slate-700">{labelByPlayer.get(pid)}</span>
                  <span
                    className={`tabular-nums font-medium ${
                      v.delta_cents > 0
                        ? "text-emerald-700"
                        : v.delta_cents < 0
                        ? "text-red-600"
                        : "text-slate-500"
                    }`}
                  >
                    {fmt(v.delta_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function BetsPanel({
  games,
  players,
  scores,
  holes
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
}) {
  if (games.length === 0)
    return <div className="text-slate-500 text-sm py-8 text-center">No games configured.</div>;
  const totals = new Map<string, number>();
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));

  for (const g of games) {
    if (g.game_type === "ctp" || g.game_type === "long_drive" || g.game_type === "custom") continue;
    const out = settleGame({
      game: g as RoundGame,
      players,
      scores,
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }
    });
    for (const [pid, v] of out.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    }
  }
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const fmt = (c: number) => (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 font-serif text-lg text-slate-900">
        Projected payouts
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map(([pid, v]) => (
          <li key={pid} className="px-4 py-3 flex items-center justify-between">
            <span className="text-slate-700">{labelByPlayer.get(pid)}</span>
            <span
              className={`tabular-nums font-medium ${
                v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-slate-500"
              }`}
            >
              {fmt(v)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
