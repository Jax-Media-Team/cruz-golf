"use client";
import { useEffect, useRef, useState } from "react";
import { BrandLockup } from "./BrandLockup";
import type { LeaderboardRow } from "@/lib/scoring";
import {
  diffPositions,
  expireMovements,
  fmtMovement,
  mergeMovements,
  type MovementDelta
} from "@/lib/leaderboard-movement";

export type LeaderboardTab = "gross" | "net" | "skins" | "match" | "bets";

type Props = {
  /** Course or round title shown under the header */
  courseName: string;
  date?: string;
  status?: "draft" | "live" | "finalized";
  rows: LeaderboardRow[];
  tab: LeaderboardTab;
  onTabChange: (t: LeaderboardTab) => void;
  /** Render the active non-leaderboard tab content. The component owns
   *  the gross/net leaderboard tabs internally; consumers render skins/team/bets. */
  alternateContent?: React.ReactNode;
  onPlayerClick?: (rpId: string) => void;
};

const TABS: Array<{ key: LeaderboardTab; label: string }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "skins", label: "Skins" },
  // "Match" covers Nassau (front/back/overall), 6-6-6 (3 segments),
  // Best Ball / Aggregate / Scramble (team vs team match state). Was
  // "Team" — renamed because Nassau can be 1v1 head-to-head and the
  // user feedback was that the live match state was the biggest
  // gameplay-clarity gap.
  { key: "match", label: "Match" },
  { key: "bets", label: "Bets" }
];

function fmtPar(vsPar: number, played: number): string {
  if (played === 0) return "—";
  if (vsPar === 0) return "E";
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
}

export function Leaderboard({
  courseName,
  date,
  status,
  rows,
  tab,
  onTabChange,
  alternateContent,
  onPlayerClick
}: Props) {
  const isLeaderboardTab = tab === "gross" || tab === "net";
  const mode = tab === "gross" ? "gross" : "net";

  return (
    <section className="rounded-2xl overflow-hidden shadow-soft border border-brand-900/15 bg-white">
      {/* Header bar — deep green */}
      <div className="bg-brand-900 text-cream-50 px-5 sm:px-7 py-5 sm:py-6 flex items-center gap-4 sm:gap-6">
        <span className="hidden sm:inline-flex">
          <BrandLockup iconHeight={104} />
        </span>
        <span className="sm:hidden inline-flex">
          <BrandLockup iconHeight={68} />
        </span>
        <div className="flex-1 min-w-0 hidden sm:block">
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.32em] text-gold-400">
            {date ? `${date} · ` : ""}Live scoring
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl mt-1 leading-tight">Leaderboard</h2>
          <p className="text-sm text-cream-100/65 mt-0.5 truncate">{courseName}</p>
        </div>
        <div className="flex-1 min-w-0 sm:hidden">
          <h2 className="font-serif text-2xl leading-tight truncate">Leaderboard</h2>
          <p className="text-xs text-cream-100/65 mt-0.5 truncate">{courseName}</p>
        </div>
        {status && (
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
              status === "live"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40"
                : status === "finalized"
                ? "bg-cream-50 text-brand-900"
                : "bg-cream-100/15 text-cream-100/80"
            }`}
          >
            {status === "live" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            {status === "live" ? "Live" : status === "finalized" ? "Final" : "Draft"}
          </span>
        )}
      </div>

      {/* Tab strip — gold underline accent on active tab */}
      <div className="bg-brand-900 border-t border-gold-500/30 sticky top-0 z-20 sm:static">
        <div role="tablist" className="flex overflow-x-auto px-2 sm:px-4">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(t.key)}
                className={`px-4 sm:px-5 py-3 text-[11px] sm:text-xs uppercase tracking-[0.22em] whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? "text-gold-400 border-gold-500"
                    : "text-cream-100/60 hover:text-cream-50 border-transparent"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      {isLeaderboardTab ? (
        // key={mode} resets the movement tracker when the user toggles
        // gross/net — those are different rankings, the deltas don't
        // carry over.
        <LeaderboardTable
          key={mode}
          rows={rows}
          mode={mode}
          onPlayerClick={onPlayerClick}
        />
      ) : (
        <div className="bg-white p-5">{alternateContent}</div>
      )}
    </section>
  );
}

/**
 * Track rank movement across re-renders. On mount, captures the initial
 * positions WITHOUT generating indicators (no false signals on first
 * paint). On each subsequent render, computes diffPositions vs the last
 * snapshot and stores any non-zero movements with a 6s TTL.
 *
 * The hook is "live-aware": only score-driven re-renders cause movement.
 * Tab switches reset the hook because LeaderboardTable is keyed by mode.
 */
const MOVEMENT_TTL_MS = 6_000;

function useRowMovement(
  rows: LeaderboardRow[]
): Map<string, MovementDelta> {
  const lastSnapshotRef = useRef<Map<string, number> | null>(null);
  const [movements, setMovements] = useState<Map<string, MovementDelta>>(
    new Map()
  );

  // Capture snapshot + compute incoming deltas
  useEffect(() => {
    const next = new Map<string, number>();
    for (const r of rows) next.set(r.round_player_id, r.position);

    if (lastSnapshotRef.current === null) {
      // Initial mount — establish baseline, no indicators.
      lastSnapshotRef.current = next;
      return;
    }

    const now = Date.now();
    const incoming = diffPositions(lastSnapshotRef.current, next, now);
    lastSnapshotRef.current = next;
    if (incoming.size > 0) {
      setMovements((prev) => mergeMovements(prev, incoming));
    }
  }, [rows]);

  // Fade old movements out after the TTL — runs while any indicator is
  // still visible.
  useEffect(() => {
    if (movements.size === 0) return;
    const id = setInterval(() => {
      setMovements((prev) => expireMovements(prev, Date.now(), MOVEMENT_TTL_MS));
    }, 1_000);
    return () => clearInterval(id);
  }, [movements]);

  return movements;
}

function LeaderboardTable({
  rows,
  mode,
  onPlayerClick
}: {
  rows: LeaderboardRow[];
  mode: "gross" | "net";
  onPlayerClick?: (rpId: string) => void;
}) {
  const movements = useRowMovement(rows);
  // Mobile cols: Pos · Player · Today · Thru · Net
  // Desktop cols: Pos · Player · Today · Thru · Front · Back · Total · Net
  const mobileGrid =
    "grid grid-cols-[44px_minmax(0,1fr)_64px_52px_60px] sm:grid-cols-[60px_minmax(0,1fr)_72px_56px_60px_60px_72px_72px]";

  return (
    <div className="bg-white">
      {/* Column header — sticky on mobile so the leaderboard is easy to scroll */}
      <div
        className={`${mobileGrid} px-4 sm:px-6 py-2.5 border-b border-slate-200 text-[10px] uppercase tracking-[0.2em] font-medium text-slate-500 bg-slate-50 sticky top-0 z-10 sm:static`}
      >
        <div>Pos</div>
        <div>Player</div>
        <div className="text-right">Today</div>
        <div className="text-right">Thru</div>
        <div className="hidden sm:block text-right">Front</div>
        <div className="hidden sm:block text-right">Back</div>
        <div className="hidden sm:block text-right">{mode === "gross" ? "Gross" : "Total"}</div>
        <div className="text-right sm:text-right">{mode === "gross" ? "Net" : "Net"}</div>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-slate-500 text-sm">No players yet.</div>
      ) : (
        <ol>
          {rows.map((r) => {
            const interactive = !!onPlayerClick;
            const under = r.thru > 0 && r.vsPar < 0;
            const movement = movements.get(r.round_player_id);
            return (
              <li
                key={r.round_player_id}
                onClick={interactive ? () => onPlayerClick!(r.round_player_id) : undefined}
                className={`${mobileGrid} items-center px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 last:border-b-0 ${
                  interactive ? "cursor-pointer hover:bg-gold-300/10 transition-colors" : ""
                }`}
              >
                <div className="font-serif text-2xl text-gold-600 tabular-nums flex items-baseline gap-1.5">
                  <span>{r.position}</span>
                  {movement && movement.delta !== 0 && (
                    <span
                      className={`text-[10px] font-sans font-medium tabular-nums transition-opacity ${
                        movement.delta > 0
                          ? "text-emerald-600"
                          : "text-red-500"
                      }`}
                      aria-label={
                        movement.delta > 0
                          ? `up ${movement.delta} positions`
                          : `down ${Math.abs(movement.delta)} positions`
                      }
                    >
                      {fmtMovement(movement.delta)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-serif text-lg sm:text-xl text-slate-900 truncate">{r.display_name}</div>
                </div>
                <div
                  className={`text-right font-serif tabular-nums text-2xl sm:text-3xl leading-none ${
                    under ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {fmtPar(r.vsPar, r.thru)}
                </div>
                <div className="text-right tabular-nums text-slate-500 text-sm">
                  {r.thru === 0 ? "—" : r.thru >= 18 ? "F" : r.thru}
                </div>
                <div className="hidden sm:block text-right tabular-nums text-slate-700">
                  {r.front ?? "—"}
                </div>
                <div className="hidden sm:block text-right tabular-nums text-slate-700">
                  {r.back ?? "—"}
                </div>
                <div className="hidden sm:block text-right tabular-nums text-slate-900 font-medium">
                  {r.thru === 0 ? "—" : mode === "gross" ? r.gross : r.gross}
                </div>
                <div className="text-right tabular-nums text-slate-900 font-medium">
                  {r.thru === 0 ? "—" : r.net}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
