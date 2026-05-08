"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import { buildPlayerSheet, leaderboard } from "@/lib/scoring";
import { settleGame } from "@/lib/games";
import {
  DEMO_PLAYERS,
  DEMO_SCORES,
  DEMO_HOLES,
  DEMO_GAMES,
  DEMO_ROUND
} from "@/lib/demo";

export default function DemoRoundPage() {
  const [tab, setTab] = useState<LeaderboardTab>("net");
  const router = useRouter();

  const sheets = DEMO_PLAYERS.map((p) => buildPlayerSheet(p, DEMO_SCORES, DEMO_HOLES));
  const mode = tab === "gross" ? "gross" : "net";
  const board = leaderboard(sheets, mode);

  const labelByPlayer = new Map(DEMO_PLAYERS.map((p) => [p.id, p.display_name]));
  const par = DEMO_HOLES.reduce((s, h) => s + h.par, 0);

  const skinsOut = settleGame({
    game: DEMO_GAMES.find((g) => g.game_type === "skins_net")!,
    players: DEMO_PLAYERS,
    scores: DEMO_SCORES,
    course: { holes: DEMO_HOLES, par }
  });

  const teamGame = DEMO_GAMES.find((g) => g.game_type === "best_ball_net")!;
  const teamOut = settleGame({
    game: teamGame,
    players: DEMO_PLAYERS,
    scores: DEMO_SCORES,
    course: { holes: DEMO_HOLES, par }
  });

  // Aggregate projected payouts across all stake-bearing games for the Bets tab
  const totals = new Map<string, number>();
  for (const id of DEMO_PLAYERS.map((p) => p.id)) totals.set(id, 0);
  for (const g of DEMO_GAMES) {
    if (g.game_type === "ctp" || g.game_type === "long_drive" || g.game_type === "custom") continue;
    const out = settleGame({
      game: g,
      players: DEMO_PLAYERS,
      scores: DEMO_SCORES,
      course: { holes: DEMO_HOLES, par }
    });
    for (const [pid, v] of out.perPlayer) {
      totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
    }
  }
  const betsRows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const fmt = (c: number) => (c >= 0 ? "+" : "−") + "$" + (Math.abs(c) / 100).toFixed(2);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Live leaderboard · {DEMO_ROUND.date}</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{DEMO_ROUND.course_name}</h1>
          <p className="text-sm text-cream-100/55 mt-0.5">Saturday Crew · 4 players · 3 games in play</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="surface rounded-xl px-3 py-2 inline-flex items-center gap-3">
            <span className="h-eyebrow">PIN</span>
            <span className="font-serif text-2xl tracking-[0.3em] text-cream-50">4218</span>
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="surface rounded-full px-3 py-1 text-xs text-cream-100/85 inline-flex items-center gap-2">
          <span className="font-medium text-cream-50">Friendly Nassau</span>
          <span className="text-gold-400">$5 / $5 / $10</span>
        </span>
        <span className="surface rounded-full px-3 py-1 text-xs text-cream-100/85 inline-flex items-center gap-2">
          <span className="font-medium text-cream-50">Net Skins</span>
          <span className="text-gold-400">$1 / skin</span>
        </span>
        <span className="surface rounded-full px-3 py-1 text-xs text-cream-100/85 inline-flex items-center gap-2">
          <span className="font-medium text-cream-50">2-man Best Ball</span>
          <span className="text-gold-400">$10</span>
        </span>
      </div>

      <Leaderboard
        courseName={`${DEMO_PLAYERS[0].tee.name} · 18 holes`}
        date={DEMO_ROUND.date}
        status={DEMO_ROUND.status}
        rows={board}
        tab={tab}
        onTabChange={setTab}
        onPlayerClick={() => router.push("/demo/round/score")}
        alternateContent={
          tab === "skins" ? (
            <div className="space-y-2">
              <div className="font-serif text-lg text-slate-900 mb-2">Net Skins</div>
              {skinsOut.highlights.length === 0 ? (
                <div className="text-sm text-slate-500">All skins pushed so far. Carry it back!</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {skinsOut.highlights.map((h, i) => (
                    <li key={i} className="py-2.5 flex items-center justify-between text-sm">
                      <span className="text-slate-600">Hole {h.hole}</span>
                      <span className="text-slate-900 font-medium">{h.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === "team" ? (
            <div className="space-y-2">
              <div className="font-serif text-lg text-slate-900 mb-2">2-man Best Ball (Net)</div>
              <ul className="divide-y divide-slate-100 text-sm">
                {[...teamOut.perPlayer.entries()].sort((a, b) => b[1].delta_cents - a[1].delta_cents).map(([pid, v]) => (
                  <li key={pid} className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-700">{labelByPlayer.get(pid)}</span>
                    <span
                      className={`tabular-nums font-medium ${
                        v.delta_cents > 0 ? "text-emerald-700" : v.delta_cents < 0 ? "text-red-600" : "text-slate-500"
                      }`}
                    >
                      {fmt(v.delta_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : tab === "bets" ? (
            <div className="space-y-2">
              <div className="font-serif text-lg text-slate-900 mb-2">Projected payouts (all games)</div>
              <ul className="divide-y divide-slate-100 text-sm">
                {betsRows.map(([pid, v]) => (
                  <li key={pid} className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-700">{labelByPlayer.get(pid)}</span>
                    <span
                      className={`tabular-nums font-medium ${
                        v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-slate-500"
                      }`}
                    >
                      {fmt(v)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
      />

      <p className="text-xs text-cream-100/50 text-center">
        Tap any player row to drop into the score-entry view.
      </p>
    </div>
  );
}
