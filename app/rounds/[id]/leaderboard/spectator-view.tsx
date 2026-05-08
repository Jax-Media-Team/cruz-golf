"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import type { CourseHole, RoundPlayer, Score } from "@/lib/types";

export function SpectatorView({
  round,
  rps,
  scores: initialScores
}: {
  round: any;
  rps: any[];
  scores: Score[];
}) {
  const [tab, setTab] = useState<LeaderboardTab>("net");
  const [scores, setScores] = useState<Score[]>(initialScores);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const players: RoundPlayer[] = useMemo(
    () =>
      rps.map((r: any) => ({
        id: r.id,
        player_id: r.id,
        display_name: r.players?.display_name ?? "Player",
        tee_id: "",
        tee: {
          id: "",
          name: "",
          rating: 72,
          slope: 113,
          par: 72,
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
  const holes = players[0]?.tee?.holes ?? [];

  // Realtime updates for spectators
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`spectator-${round.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        const ids = new Set(rps.map((r) => r.id));
        if (!ids.has(row.round_player_id)) return;
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
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [round.id, rps]);

  const sheets = players.map((p) => buildPlayerSheet(p, scores, holes));
  const mode = tab === "gross" ? "gross" : "net";
  const board = leaderboard(sheets, mode);

  function copyLink() {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    setShareNote("Link copied — anyone can watch.");
    setTimeout(() => setShareNote(null), 2200);
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-end">
          <button className="btn-secondary text-xs" onClick={copyLink}>
            {shareNote ?? "Share link"}
          </button>
        </div>
        <Leaderboard
          courseName={round.courses?.name ?? "Round"}
          date={round.date}
          status={round.status}
          rows={board}
          tab={tab}
          onTabChange={setTab}
          alternateContent={
            <div className="text-slate-500 text-sm py-6 text-center">
              That tab is only available inside the round dashboard for invitees.
            </div>
          }
        />
        <p className="text-center text-xs text-cream-100/45">
          Public leaderboard · scores update live · login required to enter scores
        </p>
      </div>
    </main>
  );
}
