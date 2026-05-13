"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { settleGame } from "@/lib/games";
import {
  settleManualPress,
  type HoleResult,
  type ManualPress
} from "@/lib/games/press";
import {
  buildLiveMatchState,
  fmtSegmentStatus,
  fmtAutoPressStatus,
  type LiveMatchState
} from "@/lib/games/live-state";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import type { CourseHole, RoundGame, RoundPlayer, Score } from "@/lib/types";

type RP = any;

export type RoundManualPress = ManualPress & {
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
};

export function RoundView({
  roundId,
  rps,
  initialScores,
  games,
  manualPresses = [],
  totalHoles = 18,
  startingHole = 1
}: {
  roundId: string;
  rps: RP[];
  initialScores: Score[];
  games: any[];
  /** Accepted + pending presses. BetsPanel uses only `status === "accepted"`
   *  for the projected payout — pending presses don't move money yet. */
  manualPresses?: RoundManualPress[];
  totalHoles?: 9 | 18;
  startingHole?: number;
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
          <SkinsPanel games={games} players={players} scores={scores} holes={holes} totalHoles={totalHoles} startingHole={startingHole} />
        ) : tab === "match" ? (
          <MatchPanel
            games={games}
            players={players}
            scores={scores}
            holes={holes}
            totalHoles={totalHoles}
            startingHole={startingHole}
            manualPresses={manualPresses}
          />
        ) : tab === "bets" ? (
          <BetsPanel
            games={games}
            players={players}
            scores={scores}
            holes={holes}
            totalHoles={totalHoles}
            startingHole={startingHole}
            manualPresses={manualPresses}
          />
        ) : null
      }
    />
  );
}

function SkinsPanel({
  games,
  players,
  scores,
  holes,
  totalHoles,
  startingHole
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
  totalHoles: 9 | 18;
  startingHole: number;
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
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }, totalHoles, startingHole
        });
        return (
          <div key={g.id} className="rounded-xl border border-slate-200 bg-white">
            {/* min-w-0 + truncate on the title so a long game name
                (e.g. "Best Ball Net + Aggregate Combined") doesn't push
                the card past the viewport on a 375px phone. Patrick
                2026-05-13 horizontal-scroll audit. */}
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between gap-3 min-w-0">
              <span className="font-serif text-lg text-slate-900 truncate min-w-0">{g.name}</span>
              <StatusPill status={out.status} />
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {out.highlights.length === 0 && (
                <li className="px-4 py-3 text-slate-500">
                  {out.status === "live"
                    ? "No skins awarded yet — updates as each hole is fully scored."
                    : "No skins awarded — every hole tied or pushed."}
                </li>
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

function MatchPanel({
  games,
  players,
  scores,
  holes,
  totalHoles,
  startingHole,
  manualPresses = []
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
  totalHoles: 9 | 18;
  startingHole: number;
  manualPresses?: RoundManualPress[];
}) {
  // Patrick's polish-phase finding: the old "Team" tab only listed
  // cents deltas — it never showed the actual match state ("front:
  // Pat+Ben up 1 thru 6"). That was the single biggest gameplay-
  // clarity gap. The Match tab now surfaces live segment-by-segment
  // state for every match-style game on the round, then shows the
  // per-player cash deltas below as supporting context.
  const matchGames = games.filter((g) =>
    [
      "nassau",
      "match_play",
      "six_six_six",
      "best_ball_gross",
      "best_ball_net",
      "aggregate_gross",
      "aggregate_net",
      "scramble_gross",
      "scramble_net"
    ].includes(String(g.game_type))
  );
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));
  if (matchGames.length === 0)
    return (
      <div className="text-slate-500 text-sm py-8 text-center">
        No match-style game on this round.
        <br />
        Add Nassau, 6-6-6, Best Ball, Aggregate, or Scramble to see live
        match state here.
      </div>
    );

  const fmt = (c: number) =>
    (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="space-y-4">
      {matchGames.map((g) => {
        const gameInput = {
          game: g as RoundGame,
          players,
          scores,
          course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
          totalHoles,
          startingHole
        };
        const out = settleGame(gameInput);
        const liveState = buildLiveMatchState(gameInput);
        const rows = [...out.perPlayer.entries()].sort(
          (a, b) => b[1].delta_cents - a[1].delta_cents
        );

        // Accepted presses attached to this game (or round-level — no
        // game_id). Pending presses are surfaced as a count hint so
        // players know more money may move once accepted.
        const acceptedPressesOnThisGame = manualPresses.filter(
          (p) =>
            p.status === "accepted" &&
            ((p as any).game_id == null || (p as any).game_id === g.id)
        );
        const pendingPressesOnThisGame = manualPresses.filter(
          (p) =>
            p.status === "pending" &&
            ((p as any).game_id == null || (p as any).game_id === g.id)
        );

        return (
          <div
            key={g.id}
            className="rounded-xl border border-slate-200 bg-white overflow-hidden"
          >
            {/* Game header — min-w-0 + truncate guard same as the
                Skins panel above. */}
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between gap-3 min-w-0">
              <span className="font-serif text-lg text-slate-900 truncate min-w-0">
                {g.name}
              </span>
              <StatusPill status={out.status} />
            </div>

            {/* Live segment-by-segment match state */}
            {liveState && liveState.segments.length > 0 && (
              <div className="divide-y divide-slate-100">
                {liveState.segments.map((seg, idx) => (
                  <div
                    key={`${liveState.game_id}-${idx}`}
                    className="px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500">
                        {seg.segment_label}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {seg.holes_played}/{seg.total_holes}
                      </div>
                    </div>
                    {/* For 6-6-6 + Nassau team play, show the team labels
                        so the rotating partners are visible per segment. */}
                    {liveState.variant === "six_six_six" && (
                      <div className="mt-1 text-xs text-slate-600">
                        {seg.side_a.label}{" "}
                        <span className="text-slate-400">vs</span>{" "}
                        {seg.side_b.label}
                      </div>
                    )}
                    <div className="mt-1 text-sm text-slate-900 font-medium">
                      {fmtSegmentStatus(seg)}
                    </div>
                    {/* Live auto-press chain inside this segment. Each
                        entry is its own mini-match opened when a side
                        went 2 down with 3+ holes left. We show the
                        same "up X thru Y" / "dormie" / "finished"
                        language as the segment so players can read it
                        without thinking. Settled presses dim. */}
                    {seg.auto_presses.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {seg.auto_presses.map((p) => {
                          const settled = p.settled_delta != null && p.holes_played === p.total_holes;
                          return (
                            <li
                              key={`${liveState.game_id}-${idx}-press-${p.index}`}
                              className={`text-xs ${
                                settled ? "text-slate-500" : "text-amber-700"
                              }`}
                            >
                              {!settled && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 align-middle" />
                              )}
                              {fmtAutoPressStatus(
                                p,
                                seg.side_a.label,
                                seg.side_b.label
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Press context for this game — shows accepted + pending */}
            {(acceptedPressesOnThisGame.length > 0 ||
              pendingPressesOnThisGame.length > 0) && (
              <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-600">
                {acceptedPressesOnThisGame.length > 0 &&
                  `${acceptedPressesOnThisGame.length} accepted press${acceptedPressesOnThisGame.length === 1 ? "" : "es"} in play`}
                {acceptedPressesOnThisGame.length > 0 &&
                  pendingPressesOnThisGame.length > 0 &&
                  " · "}
                {pendingPressesOnThisGame.length > 0 &&
                  `${pendingPressesOnThisGame.length} pending`}
              </div>
            )}

            {/* Per-player cash totals — supporting info, not the focus.
                Collapsed visual weight (smaller text) below the
                match-state which is now the primary read. */}
            <details className="border-t border-slate-100">
              <summary className="cursor-pointer px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 hover:bg-slate-50 select-none">
                Per-player projected payouts
              </summary>
              <ul className="divide-y divide-slate-100 text-sm">
                {rows.map(([pid, v]) => (
                  <li
                    key={pid}
                    className="px-4 py-2 flex items-center justify-between"
                  >
                    <span className="text-slate-700">
                      {labelByPlayer.get(pid)}
                    </span>
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
              {out.status === "live" && (
                <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">
                  Updates as remaining holes are scored.
                </div>
              )}
            </details>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: "live" | "final" }) {
  if (status === "final") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300/50">
        Final
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-300/50">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      Live
    </span>
  );
}

function BetsPanel({
  games,
  players,
  scores,
  holes,
  totalHoles,
  startingHole,
  manualPresses = []
}: {
  games: any[];
  players: RoundPlayer[];
  scores: Score[];
  holes: CourseHole[];
  totalHoles: 9 | 18;
  startingHole: number;
  manualPresses?: RoundManualPress[];
}) {
  const acceptedPresses = manualPresses.filter((p) => p.status === "accepted");
  if (games.length === 0 && acceptedPresses.length === 0)
    return <div className="text-slate-500 text-sm py-8 text-center">No games configured.</div>;
  const totals = new Map<string, number>();
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));
  let anyLive = false;

  // 1. Parent games settle as before.
  for (const g of games) {
    if (g.game_type === "ctp" || g.game_type === "long_drive" || g.game_type === "custom") continue;
    const out = settleGame({
      game: g as RoundGame,
      players,
      scores,
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      totalHoles,
      startingHole
    });
    if (out.status === "live") anyLive = true;
    for (const [pid, v] of out.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    }
  }

  // 2. Accepted manual presses contribute to projected payout. Mirrors
  //    the settlement logic from finalize-view.tsx:
  //      - best-ball gross-min per side per hole
  //      - hole is `incomplete` if any side member's score is missing
  //      - settled press → loser pays stake; winners split pot, with
  //        the remainder cent going to the first sorted winner id.
  //    Until every hole in the press range is scored, the press's
  //    contribution stays at 0 (result_delta === null) and the Bets
  //    tab reflects the partial state. Once complete, the projected
  //    payouts include the press — no more "where's the press money?"
  //    confusion mid-round.
  const grossByRpHole = new Map<string, number>();
  for (const s of scores) {
    if (s.gross == null) continue;
    grossByRpHole.set(`${s.round_player_id}:${s.hole_number}`, s.gross);
  }
  for (const press of acceptedPresses) {
    if (press.side_a_rp_ids.length === 0) continue;
    if (press.side_b_rp_ids.length === 0) continue;
    const holeResults: HoleResult[] = holes.map((h) => {
      const aScores = press.side_a_rp_ids
        .map((rp) => grossByRpHole.get(`${rp}:${h.hole_number}`))
        .filter((v): v is number => v != null);
      const bScores = press.side_b_rp_ids
        .map((rp) => grossByRpHole.get(`${rp}:${h.hole_number}`))
        .filter((v): v is number => v != null);
      const complete =
        aScores.length === press.side_a_rp_ids.length &&
        bScores.length === press.side_b_rp_ids.length;
      if (!complete) {
        return {
          hole_number: h.hole_number,
          a_won: false,
          b_won: false,
          push: false,
          incomplete: true
        };
      }
      const a = Math.min(...aScores);
      const b = Math.min(...bScores);
      return {
        hole_number: h.hole_number,
        a_won: a < b,
        b_won: b < a,
        push: a === b,
        incomplete: false
      };
    });
    const settled = settleManualPress(press, holeResults);
    if (settled.result_delta == null) {
      anyLive = true;
      continue;
    }
    if (settled.result_delta === 0) continue;
    const aWon = settled.result_delta > 0;
    const winners = aWon ? press.side_a_rp_ids : press.side_b_rp_ids;
    const losers = aWon ? press.side_b_rp_ids : press.side_a_rp_ids;
    const pot = press.stake_cents * losers.length;
    for (const id of losers) {
      totals.set(id, (totals.get(id) ?? 0) - press.stake_cents);
    }
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    [...winners].sort().forEach((id, i) => {
      const delta = each + (i < remainder ? 1 : 0);
      totals.set(id, (totals.get(id) ?? 0) + delta);
    });
  }

  // Pending-press hint count — surfaced in the header so the user knows
  // the projected payout doesn't include presses that haven't been
  // accepted yet. We don't include pending presses in the math because
  // they may never settle.
  const pendingCount = manualPresses.filter(
    (p) => p.status === "pending"
  ).length;

  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const fmt = (c: number) =>
    (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-serif text-lg text-slate-900">
            Projected payouts
          </span>
          {acceptedPresses.length > 0 && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              Includes {acceptedPresses.length} accepted press
              {acceptedPresses.length === 1 ? "" : "es"}.
              {pendingCount > 0
                ? ` ${pendingCount} pending — not counted until accepted.`
                : ""}
            </p>
          )}
          {acceptedPresses.length === 0 && pendingCount > 0 && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              {pendingCount} press{pendingCount === 1 ? "" : "es"} pending —
              not counted until accepted.
            </p>
          )}
        </div>
        <StatusPill status={anyLive ? "live" : "final"} />
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
