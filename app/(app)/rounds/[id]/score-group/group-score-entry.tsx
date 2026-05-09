"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { strokesPerHole } from "@/lib/handicap";
import { GroupScorePad, type GroupPlayer } from "@/components/GroupScorePad";
import { useScoreSaver } from "@/lib/useScoreSaver";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";

type RP = {
  id: string;
  playing_handicap: number | null;
  players?: { display_name?: string };
  course_tees?: { par: number; course_holes: { hole_number: number; par: number; stroke_index: number }[] };
};

type Existing = { round_player_id: string; hole_number: number; gross: number | null };

const k = (rpId: string, hole: number) => `${rpId}:${hole}`;

export function GroupScoreEntry({
  roundId,
  courseName,
  rps,
  existing
}: {
  roundId: string;
  courseName: string;
  rps: RP[];
  existing: Existing[];
}) {
  const saver = useScoreSaver({ roundId });

  const holes = useMemo(() => {
    const fromAny = rps.find((r) => (r.course_tees?.course_holes?.length ?? 0) > 0);
    return (fromAny?.course_tees?.course_holes ?? [])
      .slice()
      .sort((a, b) => a.hole_number - b.hole_number);
  }, [rps]);

  const allPlayers: GroupPlayer[] = useMemo(
    () =>
      rps.map((r) => ({
        id: r.id,
        display_name: r.players?.display_name ?? "Player",
        playing_handicap: r.playing_handicap ?? 0,
        strokes: strokesPerHole(r.playing_handicap ?? 0, holes)
      })),
    [rps, holes]
  );

  // Local "who's playing" toggle. Defaults to everyone in.
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allPlayers.map((p) => [p.id, true]))
  );
  useEffect(() => {
    setIncluded((prev) => {
      const next = { ...prev };
      for (const p of allPlayers) if (!(p.id in next)) next[p.id] = true;
      return next;
    });
  }, [allPlayers]);
  const players = allPlayers.filter((p) => included[p.id]);

  // Score state keyed by `${rpId}:${hole}`.
  const initial: Record<string, number | null> = {};
  for (const p of allPlayers) for (const h of holes) initial[k(p.id, h.hole_number)] = null;
  for (const s of existing) initial[k(s.round_player_id, s.hole_number)] = s.gross;
  const [scores, setScores] = useState(initial);

  function save(rpId: string, hole: number, gross: number) {
    setScores((s) => ({ ...s, [k(rpId, hole)]: gross }));
    saver.save(rpId, hole, gross);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link href={`/rounds/${roundId}`} className="btn-ghost text-sm">← Back</Link>
        <span className="text-xs uppercase tracking-[0.22em] text-cream-100/55">Group scoring</span>
      </header>

      <SaveStatusBanner state={saver.state} onRetry={saver.retry} onDiscard={saver.discard} roundId={roundId} />

      <div>
        <p className="h-eyebrow text-gold-400">Live round</p>
        <h1 className="h-display text-2xl text-cream-50 mt-1">{courseName}</h1>
      </div>

      {/* Who's playing? */}
      <div className="card p-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-cream-100/55 mb-2">Who&apos;s playing</div>
        <div className="flex flex-wrap gap-2">
          {allPlayers.map((p) => {
            const on = !!included[p.id];
            return (
              <button
                key={p.id}
                onClick={() => setIncluded((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                className={`pill text-xs px-3 py-1.5 transition-colors ${
                  on
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/65"
                }`}
                aria-pressed={on}
              >
                {on ? "✓ " : ""}
                {p.display_name}
              </button>
            );
          })}
        </div>
        {players.length === 0 && (
          <p className="text-xs text-cream-100/55 mt-2">Tap a name to include them in the scorecard.</p>
        )}
      </div>

      {players.length > 0 && (
        <GroupScorePad holes={holes} players={players} scores={scores} onSave={save} />
      )}
    </div>
  );
}
