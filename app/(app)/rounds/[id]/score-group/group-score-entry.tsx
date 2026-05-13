"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { strokesPerHole } from "@/lib/handicap";
import { GroupScorePad, type GroupPlayer } from "@/components/GroupScorePad";
import { ScoreGrid } from "@/components/ScoreGrid";
import { useScoreSaver } from "@/lib/useScoreSaver";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { JunkControls } from "../junk-controls";
import { PressControls } from "../press-controls";

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
  existing,
  roundStatus = "live",
  totalHoles = 18,
  // Junk entry props — when junk is enabled on the round, render the
  // JunkControls panel inline under the scorecard so the user records
  // birdies/sandies/chip-ins without leaving the scoring screen.
  // Patrick 2026-05-12: "easy to keep track of from within the game
  // as I am entering scores."
  junkConfig = null,
  junkItems = [],
  isCommissioner = false,
  // Press controls props — Patrick 2026-05-13: "Junk and Open Press
  // should be available directly from the Enter Scores screen."
  // Same PressControls used on the round detail page, mounted here
  // so the scorer never has to leave score entry.
  games = [],
  presses = [],
  myRpId = null
}: {
  roundId: string;
  courseName: string;
  rps: RP[];
  existing: Existing[];
  /** Used only for the eyebrow label. Score writes are NOT gated here —
   *  every status except `finalized` (blocked at the page level) is
   *  editable. Defaults to "live" for backward compat. */
  roundStatus?: "draft" | "live" | "pending_finalization" | "finalized";
  totalHoles?: 9 | 18;
  junkConfig?: any;
  junkItems?: any[];
  isCommissioner?: boolean;
  games?: any[];
  presses?: any[];
  myRpId?: string | null;
}) {
  const router = useRouter();
  const saver = useScoreSaver({ roundId });
  // Default to grid on wider screens (desktop / iPad), cards on phones.
  const [entryMode, setEntryMode] = useState<"cards" | "grid">(() => {
    if (typeof window === "undefined") return "cards";
    return window.matchMedia("(min-width: 768px)").matches ? "grid" : "cards";
  });

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

  // Scorecard-complete detection (audit P1 #11). When every included
  // player has a non-null gross for every hole, the "Done" CTA flips
  // from "View leaderboard →" to "Finalize round →" and routes to
  // /finalize instead of /#leaderboard. Pending writes block the
  // flip — finalizing on top of an in-flight write could miss data.
  const scorecardComplete = useMemo(() => {
    if (holes.length === 0 || players.length === 0) return false;
    for (const p of players) {
      for (const h of holes) {
        const v = scores[k(p.id, h.hole_number)];
        if (v == null) return false;
      }
    }
    return true;
  }, [holes, players, scores]);
  // SaverState shape: { status: Record<key, Status>, pending: number }.
  // `pending` counts items still saving or in failed-retry. Block the
  // finalize flip until pending drains so we don't navigate past an
  // in-flight write.
  const finalizeReady = scorecardComplete && saver.state.pending === 0;

  return (
    <div className="space-y-4">
      {/* Persistent leaderboard CTA. Patrick 2026-05-13: "Add clear
          leaderboard button from score entry... I have to go back to
          the round and then click leaderboard." Now one tap from the
          scoring screen to live results. Routes to the round page
          with #leaderboard anchor so the leaderboard scrolls into
          view immediately. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`/rounds/${roundId}#leaderboard`}
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
        >
          📊 Live leaderboard →
        </Link>
        <Link
          href={`/rounds/${roundId}`}
          className="text-xs text-cream-100/55 hover:text-cream-100"
        >
          ← Round overview
        </Link>
      </div>
      <SaveStatusBanner state={saver.state} onRetry={saver.retry} onDiscard={saver.discard} roundId={roundId} />

      <div>
        <p className="h-eyebrow text-gold-400">
          {roundStatus === "draft"
            ? "Draft round"
            : roundStatus === "pending_finalization"
            ? "Awaiting finalization"
            : "Live round"}
        </p>
        <h1 className="h-display text-2xl text-cream-50 mt-1">{courseName}</h1>
        {roundStatus === "draft" && (
          <p className="text-[11px] text-cream-100/55 mt-1 leading-snug">
            This round is still in draft. Scores save normally; flip it to
            live when you&apos;re ready for it to appear on leaderboards.
          </p>
        )}
        {roundStatus === "pending_finalization" && (
          <p className="text-[11px] text-cream-100/55 mt-1 leading-snug">
            Round is awaiting finalization. Still editable — fix any
            scores here, then return to the round page to finalize.
          </p>
        )}
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
        <>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setEntryMode("cards")}
              className={`pill text-xs px-3 py-1.5 transition-colors ${
                entryMode === "cards"
                  ? "bg-gold-500 text-brand-900"
                  : "bg-brand-900/60 border border-cream-100/15 text-cream-100/65"
              }`}
              aria-pressed={entryMode === "cards"}
            >
              Cards (mobile)
            </button>
            <button
              onClick={() => setEntryMode("grid")}
              className={`pill text-xs px-3 py-1.5 transition-colors ${
                entryMode === "grid"
                  ? "bg-gold-500 text-brand-900"
                  : "bg-brand-900/60 border border-cream-100/15 text-cream-100/65"
              }`}
              aria-pressed={entryMode === "grid"}
            >
              Grid (desktop)
            </button>
          </div>
          {entryMode === "cards" ? (
            <GroupScorePad
              holes={holes}
              players={players}
              scores={scores}
              onSave={save}
              onFinish={() =>
                router.push(
                  finalizeReady
                    ? `/rounds/${roundId}/finalize`
                    : `/rounds/${roundId}#leaderboard`
                )
              }
              finishLabel={finalizeReady ? "Finalize round →" : "View leaderboard →"}
            />
          ) : (
            <ScoreGrid holes={holes} players={players} scores={scores} onSave={save} />
          )}

          {/* Inline junk entry — renders only when the round has junk
              enabled. The same JunkControls component used on the round
              detail page is mounted here so the scorer never has to
              navigate away. defaultHole is the next-unscored hole
              (or 1 if nothing scored yet) so the picker lands where
              the user is currently entering. Patrick 2026-05-12:
              "How do I keep track of junk during the scorekeeping?
              Should be simple." */}
          {junkConfig && rps.length > 0 && (
            <JunkControls
              roundId={roundId}
              totalHoles={totalHoles}
              defaultHole={(() => {
                const maxScored = Object.entries(scores)
                  .filter(([_, v]) => v != null)
                  .map(([k]) => Number(k.split(":")[1]) || 0)
                  .reduce((max, h) => Math.max(max, h), 0);
                return Math.min(Math.max(1, maxScored + 1), totalHoles);
              })()}
              rps={rps.map((r) => ({
                id: r.id,
                display_name: r.players?.display_name ?? "Player"
              }))}
              config={junkConfig as any}
              initialItems={junkItems as any}
              isCommissioner={isCommissioner}
            />
          )}

          {/* Inline press controls — Patrick 2026-05-13: "Junk and
              Open Press should be available directly from the Enter
              Scores screen." Same PressControls component the round
              detail page renders, mounted under the scorecard. Only
              shown when there's at least one game with stakes; the
              round-status gate (live/pending only) lives inside
              PressControls itself, so finalized rounds reaching this
              page (rare — there's a redirect at page-load) just
              render the controls in read-only mode. */}
          {(games?.length ?? 0) > 0 && rps.length > 0 && roundStatus !== "finalized" && (
            <PressControls
              roundId={roundId}
              totalHoles={totalHoles}
              rps={rps.map((r: any) => ({
                id: r.id,
                player_id: r.player_id ?? r.id,
                team_id: r.team_id ?? null,
                display_name: r.players?.display_name ?? "Player",
                is_me: r.id === myRpId
              }))}
              games={games as any}
              presses={presses as any}
              myRpId={myRpId}
              isCommissioner={isCommissioner}
            />
          )}
        </>
      )}
    </div>
  );
}
