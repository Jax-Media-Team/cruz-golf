"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { minimumFlow, settleGame } from "@/lib/games";
import { generateRecap } from "@/lib/recap";
import { SmackTalk } from "@/components/SmackTalk";
import type { CourseHole, RoundGame, RoundPlayer, Score } from "@/lib/types";

export function FinalizeView({
  roundId,
  rps,
  scores,
  games
}: {
  roundId: string;
  rps: any[];
  scores: Score[];
  games: any[];
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
      course: { holes, par: holes.reduce((s, h) => s + h.par, 0) }
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

      <div className="card p-5">
        <h2 className="font-serif text-xl text-cream-50 mb-3">Who pays whom</h2>
        {flows.length === 0 ? (
          <p className="text-sm text-cream-100/55">Nothing owed.</p>
        ) : (
          <ul className="text-sm space-y-1.5">
            {flows.map((f, i) => (
              <li key={i} className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-cream-50">{labelByPlayer.get(f.from)}</span>
                  <span className="text-cream-100/40 mx-2">→</span>
                  <span className="font-medium text-cream-50">{labelByPlayer.get(f.to)}</span>
                </div>
                <span className="tabular-nums font-serif text-lg text-cream-50">{fmt(f.amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={finalize}>
          {busy ? "Finalizing…" : "Finalize & lock"}
        </button>
        <a
          className="btn-secondary"
          href={`/api/share/round/${roundId}/image`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open share image
        </a>
        <a
          className="btn-secondary"
          href={`/api/share/round/${roundId}/image`}
          download={`cruz-golf-${roundId}.png`}
        >
          Download PNG
        </a>
      </div>
    </div>
  );
}
