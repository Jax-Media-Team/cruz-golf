"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { minimumFlow, settleGame } from "@/lib/games";
import { generateRecap } from "@/lib/recap";
import { SmackTalk } from "@/components/SmackTalk";
import { ShareSheet } from "@/components/ShareSheet";
import type { CourseHole, RoundGame, RoundPlayer, Score } from "@/lib/types";

export function FinalizeView({
  roundId,
  rps,
  scores,
  games,
  totalHoles = 18,
  startingHole = 1
}: {
  roundId: string;
  rps: any[];
  scores: Score[];
  games: any[];
  totalHoles?: 9 | 18;
  startingHole?: number;
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          holes: (r.course_tees?.course_holes ?? []).slice().sort((a: CourseHole, b: CourseHole) => a.hole_number - b.hole_number)
        },
        handicap_index_used: 0,
        course_handicap: r.course_handicap,
        playing_handicap: r.playing_handicap,
        team_id: r.team_id
      })),
    [rps]
  );
  const holes = players[0]?.tee?.holes ?? [];

  const totals = new Map<string, number>();
  const lines: Array<{ game: string; perPlayer: Map<string, number> }> = [];
  for (const g of games) {
    const out = settleGame({
      game: g as RoundGame,
      players,
      scores,
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
      totalHoles,
      startingHole
    });
    const m = new Map<string, number>();
    for (const [pid, v] of out.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
      m.set(pid, v.delta_cents);
    }
    lines.push({ game: g.name, perPlayer: m });
  }
  const flows = minimumFlow(totals);
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));
  const fmt = (c: number) => "$" + (Math.abs(c) / 100).toFixed(2);

  async function finalize() {
    setBusy(true);
    setErr(null);
    // Wipe prior settlements for this round, then write new ones.
    await sb.from("settlements").delete().eq("round_id", roundId);
    if (flows.length > 0) {
      const { error } = await sb.from("settlements").insert(
        flows.map((f) => ({
          round_id: roundId,
          from_round_player_id: f.from,
          to_round_player_id: f.to,
          amount_cents: f.amount_cents,
          breakdown: lines.map((l) => ({ game: l.game, from: l.perPlayer.get(f.from) ?? 0, to: l.perPlayer.get(f.to) ?? 0 }))
        }))
      );
      if (error) {
        setBusy(false);
        setErr(error.message);
        return;
      }
    }
    await sb.from("rounds").update({ status: "finalized", finalized_at: new Date().toISOString() }).eq("id", roundId);
    setBusy(false);
    router.push(`/rounds/${roundId}`);
  }

  const recap = useMemo(
    () => generateRecap({ players, scores, holes, games: games as RoundGame[] }),
    [players, scores, holes, games]
  );

  return (
    <div className="space-y-5 max-w-2xl">
      <Link
        href={`/rounds/${roundId}#leaderboard`}
        className="btn-ghost text-xs"
      >
        ← Back to leaderboard
      </Link>
      <header>
        <p className="h-eyebrow">Settlement</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Finalize round</h1>
      </header>

      <SmackTalk moments={recap} />

      <div className="card p-5">
        <h2 className="font-serif text-xl text-cream-50 mb-3">By game</h2>
        <ul className="space-y-4 text-sm">
          {lines.map((l, i) => (
            <li key={i}>
              <div className="font-medium text-cream-50">{l.game}</div>
              <ul className="pl-4 mt-1 space-y-0.5">
                {[...l.perPlayer.entries()].sort((a, b) => b[1] - a[1]).map(([pid, v]) => (
                  <li key={pid} className="flex justify-between">
                    <span className="text-cream-100/80">{labelByPlayer.get(pid)}</span>
                    <span className={`tabular-nums ${v > 0 ? "text-emerald-300" : v < 0 ? "text-red-300" : "text-cream-100/55"}`}>{(v >= 0 ? "+" : "−") + fmt(v)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-xl text-cream-50">Who pays whom</h2>
          <span className="text-[11px] text-cream-100/55">
            Computed by netting every game and finding the fewest transfers.
          </span>
        </div>
        {flows.length === 0 ? (
          <p className="text-sm text-cream-100/55">Nothing owed — everyone broke even.</p>
        ) : (
          <ul className="text-sm space-y-3">
            {flows.map((f, i) => {
              // Build the explanation: each game's net delta for the FROM
              // player. Negative = they owed for that game.
              const fromDeltas = lines
                .map((l) => ({ game: l.game, cents: l.perPlayer.get(f.from) ?? 0 }))
                .filter((x) => x.cents !== 0);
              const fromTotal = fromDeltas.reduce((s, x) => s + x.cents, 0);
              return (
                <li key={i} className="border-t border-cream-100/8 first:border-t-0 first:pt-0 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-medium text-cream-50">{labelByPlayer.get(f.from)}</span>
                      <span className="text-cream-100/40 mx-2">→</span>
                      <span className="font-medium text-cream-50">{labelByPlayer.get(f.to)}</span>
                    </div>
                    <span className="tabular-nums font-serif text-lg text-cream-50">{fmt(f.amount_cents)}</span>
                  </div>
                  {/* Where this came from for the payer */}
                  {fromDeltas.length > 0 && (
                    <details className="mt-1.5 text-[11px] text-cream-100/65 leading-snug">
                      <summary className="cursor-pointer text-cream-100/55 hover:text-cream-100">
                        How this was calculated
                      </summary>
                      <div className="mt-1.5 pl-3 border-l border-cream-100/15">
                        <p className="text-[11px] text-cream-100/60 mb-1.5">
                          {labelByPlayer.get(f.from)}&apos;s net across every game in this round:
                        </p>
                        <ul className="space-y-0.5">
                          {fromDeltas.map((x, j) => (
                            <li key={j} className="flex justify-between gap-2 tabular-nums">
                              <span>{x.game}</span>
                              <span className={x.cents > 0 ? "text-emerald-300" : "text-red-300"}>
                                {x.cents >= 0 ? "+" : "−"}{fmt(x.cents)}
                              </span>
                            </li>
                          ))}
                          <li className="flex justify-between gap-2 mt-1 pt-1 border-t border-cream-100/8 tabular-nums font-medium">
                            <span className="text-cream-100/85">Net</span>
                            <span className={fromTotal >= 0 ? "text-emerald-300" : "text-red-300"}>
                              {fromTotal >= 0 ? "+" : "−"}{fmt(fromTotal)}
                            </span>
                          </li>
                        </ul>
                        {Math.abs(fromTotal) !== f.amount_cents && (
                          <p className="text-[10px] text-cream-100/55 mt-2">
                            This transfer is part of a chain — {labelByPlayer.get(f.from)} owes a total of{" "}
                            {fmt(Math.abs(fromTotal))} but it&apos;s split across multiple recipients to
                            keep the number of Venmo transfers low.
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={finalize}>
          {busy ? "Finalizing…" : "Finalize round"}
        </button>
        <ShareSheet
          title="Round results"
          url={typeof window !== "undefined" ? window.location.origin + `/rounds/${roundId}/leaderboard` : ""}
          imageUrl={`/api/share/round/${roundId}/image`}
          imageFilename={`cruz-golf-${roundId}.png`}
          triggerLabel="Share"
          triggerClassName="btn-secondary"
        />
      </div>
      <p className="text-[11px] text-cream-100/55">
        After finalizing, the commissioner can still unlock the round to fix
        scores. Players can&apos;t edit on a finalized round until it&apos;s
        unlocked.
      </p>
    </div>
  );
}
