"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { strokesPerHole } from "@/lib/handicap";
import { ScorePad } from "@/components/ScorePad";

export function ScoreEntry({
  roundId,
  rp,
  existing
}: {
  roundId: string;
  rp: any;
  existing: { hole_number: number; gross: number | null }[];
}) {
  const sb = supabaseBrowser();
  const holes = useMemo(
    () => (rp.course_tees?.course_holes ?? []).slice().sort((a: any, b: any) => a.hole_number - b.hole_number),
    [rp]
  );
  const strokes = useMemo(() => strokesPerHole(rp.playing_handicap ?? 0, holes), [rp, holes]);

  const initial: Record<number, number | null> = {};
  for (const h of holes) initial[h.hole_number] = null;
  for (const s of existing) initial[s.hole_number] = s.gross;
  const [scores, setScores] = useState(initial);

  async function save(hole: number, gross: number) {
    setScores((s) => ({ ...s, [hole]: gross }));
    const { data: userData } = await sb.auth.getUser();
    await sb
      .from("scores")
      .upsert(
        {
          round_player_id: rp.id,
          hole_number: hole,
          gross,
          updated_by: userData.user?.id ?? null,
          updated_at: new Date().toISOString()
        },
        { onConflict: "round_player_id,hole_number" }
      );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link href={`/rounds/${roundId}`} className="btn-ghost text-sm">← Back</Link>
        <span className="text-xs uppercase tracking-[0.22em] text-cream-100/55">Live round</span>
      </header>
      <ScorePad
        playerName={rp.players?.display_name ?? "Player"}
        playingHandicap={rp.playing_handicap ?? 0}
        holes={holes}
        scores={scores}
        strokes={strokes}
        onSave={save}
      />
    </div>
  );
}
