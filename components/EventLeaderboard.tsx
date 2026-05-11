"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  buildEventFieldStandings,
  buildEventBundle,
  type EventBundleInput,
  type EventRoundShape
} from "@/lib/events/settle";
import type {
  CourseHole,
  EventGame,
  GolfEvent,
  RoundPlayer,
  Score,
  UUID
} from "@/lib/types";

/**
 * Field-wide event leaderboard. Renders the aggregated standings from
 * the event-settlement engine. Subscribes to realtime on the scores
 * table for every round in the event so the leaderboard updates within
 * ~1 socket round-trip when any foursome posts a hole.
 *
 * Used by:
 *   - /events/[id] — commissioner / group-member view
 *   - /events/[id]/leaderboard?token=... — public spectator view
 *
 * Same data, different chrome. The spectator view passes
 * `spectator=true` so we hide the back-link to /events/[id] (the
 * spectator can't access it without auth).
 */

type EventLeaderboardTab = "gross" | "net" | "money" | "foursomes";

export function EventLeaderboard({
  event,
  rounds,
  initialRps,
  initialScores,
  eventGames,
  spectator = false
}: {
  event: GolfEvent;
  rounds: EventRoundShape[];
  initialRps: Array<RoundPlayer & { round_id: UUID }>;
  initialScores: Score[];
  eventGames: EventGame[];
  spectator?: boolean;
}) {
  const [tab, setTab] = useState<EventLeaderboardTab>("net");
  const [rps] = useState(initialRps);
  const [scores, setScores] = useState<Score[]>(initialScores);

  // Realtime: subscribe to scores changes for every round in the
  // event. Cheap on Supabase Realtime — N filtered postgres_changes
  // channels. On any score change, recompute from the existing
  // local set (we re-fetch the row on each event to stay accurate).
  useEffect(() => {
    if (rounds.length === 0) return;
    const sb = supabaseBrowser();
    let cancelled = false;
    const allRpIds = new Set(rps.map((rp) => rp.id));

    async function refetch() {
      const { data } = await sb
        .from("scores")
        .select("round_player_id, hole_number, gross")
        .in("round_player_id", Array.from(allRpIds));
      if (!cancelled && data) setScores(data as Score[]);
    }

    const channel = sb
      .channel(`event-${event.id}-scores`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          if (!allRpIds.has(row.round_player_id)) return;
          // Cheap path: patch the local set. We could just refetch but
          // realtime updates fly during a tournament and we want the
          // leaderboard to feel instant.
          setScores((prev) => {
            const idx = prev.findIndex(
              (s) =>
                s.round_player_id === row.round_player_id &&
                s.hole_number === row.hole_number
            );
            const next =
              idx >= 0
                ? [...prev]
                : prev.concat([
                    {
                      round_player_id: row.round_player_id,
                      hole_number: row.hole_number,
                      gross: row.gross ?? null
                    }
                  ]);
            if (idx >= 0)
              next[idx] = { ...next[idx], gross: row.gross ?? null };
            return next;
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) refetch();
      });

    // 60s safety-net refetch in case realtime silently drops events.
    const interval = setInterval(refetch, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      sb.removeChannel(channel);
    };
  }, [event.id, rounds, rps]);

  const input: EventBundleInput = useMemo(
    () => ({
      event,
      rounds,
      rps,
      scores,
      event_games: eventGames
    }),
    [event, rounds, rps, scores, eventGames]
  );
  const bundle = useMemo(() => buildEventBundle(input), [input]);
  const { standings, per_player_event_money } = bundle;

  const fmtMoney = (cents: number) =>
    (cents >= 0 ? "+" : "−") + "$" + (Math.abs(cents) / 100).toFixed(2);
  const fmtVsPar = (n: number) =>
    n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;

  const liveCount = standings.foursomes.filter(
    (f) => f.status === "live"
  ).length;
  const pendingCount = standings.foursomes.filter(
    (f) => f.status === "pending_finalization"
  ).length;
  const finalCount = standings.foursomes.filter(
    (f) => f.status === "finalized"
  ).length;

  return (
    <section className="rounded-2xl overflow-hidden shadow-soft border border-brand-900/15 bg-white">
      {/* Header — event name + live foursome summary */}
      <div className="bg-brand-900 text-cream-50 px-5 sm:px-7 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.32em] text-gold-400">
            {event.kind === "tournament"
              ? "Tournament"
              : event.kind === "trip"
              ? "Trip"
              : "Club game"}
            {spectator ? " · Spectator" : " · Live field"}
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl mt-1 truncate">
            {event.name}
          </h2>
          <p className="text-xs text-cream-100/70 mt-1 tabular-nums">
            {standings.foursomes.length} foursome
            {standings.foursomes.length === 1 ? "" : "s"}
            {liveCount > 0 && ` · ${liveCount} live`}
            {pendingCount > 0 && ` · ${pendingCount} awaiting`}
            {finalCount > 0 && ` · ${finalCount} final`}
          </p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-slate-200 px-3 sm:px-5 bg-slate-50">
        {(
          [
            { k: "gross" as const, label: "Gross" },
            { k: "net" as const, label: "Net" },
            ...(eventGames.length > 0
              ? [{ k: "money" as const, label: "Money" }]
              : []),
            { k: "foursomes" as const, label: "Foursomes" }
          ] as Array<{ k: EventLeaderboardTab; label: string }>
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              tab === t.k
                ? "border-gold-500 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {(tab === "gross" || tab === "net") &&
        (standings.players.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">
            No players yet — add foursomes to populate the field.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {standings.players.map((p, i) => {
              const total = tab === "gross" ? p.total_gross : p.total_net;
              const vsPar =
                tab === "gross" ? p.vs_par_gross : p.vs_par_net;
              return (
                <li
                  key={p.player_id}
                  className="px-5 py-3 flex items-center gap-4"
                >
                  <span className="text-slate-400 tabular-nums w-7 text-right text-xs">
                    {i + 1}
                  </span>
                  <span className="text-slate-900 flex-1 min-w-0 truncate">
                    {p.display_name}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                    thru {p.thru_holes_total}
                  </span>
                  <span className="text-slate-500 tabular-nums text-sm shrink-0 w-12 text-right">
                    {p.thru_holes_total > 0 ? fmtVsPar(vsPar) : "—"}
                  </span>
                  <span className="text-slate-900 font-serif text-lg tabular-nums shrink-0 w-12 text-right">
                    {p.thru_holes_total > 0 ? total : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "money" && (
        <ul className="divide-y divide-slate-100 text-sm">
          {standings.players.length === 0 ? (
            <li className="px-5 py-10 text-center text-slate-500">
              No players yet.
            </li>
          ) : (
            standings.players
              .map((p) => ({
                p,
                money: per_player_event_money.get(p.player_id) ?? 0
              }))
              .sort((a, b) => b.money - a.money)
              .map(({ p, money }, i) => (
                <li
                  key={p.player_id}
                  className="px-5 py-3 flex items-center gap-4"
                >
                  <span className="text-slate-400 tabular-nums w-7 text-right text-xs">
                    {i + 1}
                  </span>
                  <span className="text-slate-900 flex-1 min-w-0 truncate">
                    {p.display_name}
                  </span>
                  <span
                    className={`tabular-nums font-medium shrink-0 ${
                      money > 0
                        ? "text-emerald-700"
                        : money < 0
                        ? "text-red-600"
                        : "text-slate-500"
                    }`}
                  >
                    {fmtMoney(money)}
                  </span>
                </li>
              ))
          )}
        </ul>
      )}

      {tab === "foursomes" && (
        <ul className="divide-y divide-slate-100 text-sm">
          {standings.foursomes.map((f) => {
            const statusColor =
              f.status === "live"
                ? "text-emerald-700 bg-emerald-50"
                : f.status === "pending_finalization"
                ? "text-amber-700 bg-amber-50"
                : f.status === "finalized"
                ? "text-slate-600 bg-slate-100"
                : "text-slate-500 bg-slate-50";
            return (
              <li key={f.round_id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-slate-900 font-medium truncate">
                      {f.course_name ?? "Course"}
                      <span className="text-slate-500 text-xs ml-2 font-normal">
                        · {f.date}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      {f.player_count} player
                      {f.player_count === 1 ? "" : "s"} · thru {f.thru_holes}/
                      {f.total_holes}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-1 ${statusColor}`}
                  >
                    {f.status === "pending_finalization"
                      ? "awaiting"
                      : f.status}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-slate-100 bg-slate-50 px-5 py-2 text-[11px] text-slate-500">
        Updates live as foursomes post scores. Presses stay foursome-scoped
        — see each round for live press status.
      </div>
    </section>
  );
}
