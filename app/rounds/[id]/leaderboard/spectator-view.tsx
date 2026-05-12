"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import { AdminSpectatorBanner } from "@/components/AdminSpectatorBanner";
import { BrandLockup } from "@/components/BrandLockup";
import type { CourseHole, RoundPlayer, Score } from "@/lib/types";

export function SpectatorView({
  round,
  rps,
  scores: initialScores,
  adminMode = false,
  isAuthenticatedViewer = false,
  groupName = null
}: {
  round: any;
  rps: any[];
  scores: Score[];
  /** True only when the signed-in viewer is a verified Platform Admin and
   *  the URL had `?adminMode=1`. Pure UI signal — no permission change. */
  adminMode?: boolean;
  /** True when the viewer is signed in. Surfaces an extra "Open in app"
   *  link in the header so they can bounce to /rounds/[id] (the
   *  authenticated round page with the SettlementSummary + full
   *  controls) instead of being stuck on the spectator surface with
   *  only a brand link. */
  isAuthenticatedViewer?: boolean;
  /** Group name used in the admin banner subject ("Sunday Crew round"). */
  groupName?: string | null;
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

  const courseName = round.courses?.name ?? "Round";

  return (
    <main className="min-h-screen">
      {adminMode && (
        <AdminSpectatorBanner
          subject={`${groupName ?? "group"} round at ${courseName}`}
          context={`${round.date} · ${round.status}`}
          backHref={`/admin/rounds/${round.id}`}
        />
      )}
      <div className="max-w-3xl mx-auto space-y-4 px-4 py-6 sm:py-10">
        {/* Header. Anonymous spectators see brand → marketing home.
            Signed-in viewers get an explicit "Open in app →" link
            that drops them on the authenticated /rounds/[id] page
            with SettlementSummary + full controls. Either way nobody
            ends up stuck. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href={isAuthenticatedViewer ? "/dashboard" : "/"}
            className="inline-flex items-center hover:opacity-90 transition-opacity"
            aria-label={isAuthenticatedViewer ? "Back to dashboard" : "Cruz Golf home"}
          >
            <BrandLockup iconHeight={28} />
          </Link>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isAuthenticatedViewer && (
              <Link
                href={`/rounds/${round.id}`}
                className="btn-secondary text-xs"
              >
                Open in app →
              </Link>
            )}
            <button className="btn-secondary text-xs" onClick={copyLink}>
              {shareNote ?? "Share link"}
            </button>
          </div>
        </div>
        <Leaderboard
          courseName={round.courses?.name ?? "Round"}
          date={round.date}
          status={round.status}
          rows={board}
          tab={tab}
          onTabChange={setTab}
          alternateContent={
            // Spectator-mode tabs that don't apply to a public viewer
            // (skins/team/bets are private settlement detail). The copy
            // is intentional — "you're watching, not playing" — rather
            // than the old broken-sounding "tab only available for
            // invitees" line.
            <div className="text-cream-100/70 text-sm py-6 px-4 text-center space-y-1">
              <p className="font-medium text-cream-50">
                Spectator view · gross + net only
              </p>
              <p className="text-xs text-cream-100/55 max-w-sm mx-auto">
                Skins, teams, and wagers stay inside the group. Sign in
                from a player&apos;s phone to see their share, or watch the
                live scores from the Gross / Net tabs above.
              </p>
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
