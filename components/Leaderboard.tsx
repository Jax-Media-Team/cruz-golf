"use client";
import { BrandLockup } from "./BrandLockup";
import type { LeaderboardRow } from "@/lib/scoring";
import { fmtMovement } from "@/lib/leaderboard-movement";
import { useRowMovement } from "@/lib/use-row-movement";
import { useMemo } from "react";

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
  /** Game types actually enabled on this round. When provided, the
   *  "Skins" + "Game" tabs only show if a matching game is enabled.
   *  Patrick 2026-05-13 #8: "If I did not select Skins, I should not
   *  see Skins."
   *  When omitted (legacy callers, demo pages), all tabs show — same
   *  behavior as before. */
  enabledGameTypes?: string[];
};

const ALL_TABS: Array<{ key: LeaderboardTab; label: string }> = [
  // Always-visible tabs — the leaderboard answers "who's winning the
  // round" and "who owes who" regardless of which games are enabled.
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  // Conditional: only when at least one skins_* game is enabled.
  { key: "skins", label: "Skins" },
  // Conditional: "Game" covers Nassau / 6-6-6 / Best Ball / Scramble /
  // Aggregate / team_match / match_play. Renamed from "Match" → "Game"
  // (audit P1 #12) so first-time users connect it to their Nassau.
  { key: "match", label: "Game" },
  // Always-visible: Money is the running $-flow across whatever
  // games ARE enabled — useful even on a Skins-only round.
  { key: "bets", label: "Money" }
];

/** Predicate: should this tab be visible given the round's enabled games? */
function tabIsVisible(
  key: LeaderboardTab,
  enabledGameTypes: string[] | undefined
): boolean {
  // Always-visible: gross / net / bets.
  if (key === "gross" || key === "net" || key === "bets") return true;
  // No filter provided → show everything (legacy demo callers).
  if (!enabledGameTypes) return true;
  if (key === "skins") {
    return enabledGameTypes.some((t) => t.startsWith("skins"));
  }
  if (key === "match") {
    return enabledGameTypes.some((t) =>
      [
        "nassau",
        "match_play",
        "team_match",
        "best_ball",
        "best_ball_gross",
        "best_ball_net",
        "six_six_six",
        "scramble",
        "scramble_gross",
        "scramble_net",
        "aggregate",
        "aggregate_gross",
        "aggregate_net"
      ].includes(t)
    );
  }
  return true;
}

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
  onPlayerClick,
  enabledGameTypes
}: Props) {
  // Filter the tab list to whatever's actually playable on this round.
  // Patrick 2026-05-13 #8: "If I did not select Skins, I should not see
  // Skins." The "Money" tab stays visible because money flows on every
  // round with stakes regardless of game family.
  const visibleTabs = useMemo(
    () => ALL_TABS.filter((t) => tabIsVisible(t.key, enabledGameTypes)),
    [enabledGameTypes]
  );

  // If the active tab was filtered out (e.g. user was on Skins, then
  // the round had skins disabled by an edit), fall back to Net silently.
  // This effect was the inline call-site's job before — now it's the
  // component's responsibility since it owns the filter logic.
  const activeTab: LeaderboardTab = useMemo(() => {
    if (visibleTabs.some((t) => t.key === tab)) return tab;
    return "net";
  }, [tab, visibleTabs]);

  const isLeaderboardTab = activeTab === "gross" || activeTab === "net";
  const mode = activeTab === "gross" ? "gross" : "net";

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

      {/* Tab strip — gold underline accent on active tab. Tabs filtered
          to enabled games (#8); see `tabIsVisible` above. */}
      <div className="bg-brand-900 border-t border-gold-500/30 sticky top-0 z-20 sm:static">
        <div role="tablist" className="flex overflow-x-auto px-2 sm:px-4">
          {visibleTabs.map((t) => {
            const active = t.key === activeTab;
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


function LeaderboardTable({
  rows,
  mode,
  onPlayerClick
}: {
  rows: LeaderboardRow[];
  mode: "gross" | "net";
  onPlayerClick?: (rpId: string) => void;
}) {
  const positions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.round_player_id, r.position);
    return m;
  }, [rows]);
  const movements = useRowMovement(positions);
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
