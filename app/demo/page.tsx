"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Leaderboard, type LeaderboardTab } from "@/components/Leaderboard";
import { ScorePad } from "@/components/ScorePad";
import { buildPlayerSheet, leaderboard as buildBoard } from "@/lib/scoring";
import { settleGame } from "@/lib/games";
import { strokesPerHole } from "@/lib/handicap";
import {
  DEMO_PLAYERS,
  DEMO_SCORES,
  DEMO_HOLES,
  DEMO_GAMES,
  DEMO_PROFILES
} from "@/lib/demo";
import { generateRecap } from "@/lib/recap";
import { SmackTalk } from "@/components/SmackTalk";

type StepId =
  | "hero"
  | "setup"
  | "games"
  | "wagers"
  | "scoring"
  | "leaderboard"
  | "settle"
  | "cta";

const STEPS: Array<{
  id: StepId;
  title: string;
  caption: string;
  hint?: string;
}> = [
  {
    id: "hero",
    title: "Saturday morning at the club",
    caption: "Four guys, eighteen holes, real money on the line. Watch a Cruz Golf round run end-to-end.",
    hint: "Tap Next to begin · Auto plays it for you"
  },
  {
    id: "setup",
    title: "Build the round in 90 seconds",
    caption: "Pick the course, drop the players in, set tees per player. Add a guest who isn't on an account? Type a name and you're done. Works for one group of four or a small members' day.",
    hint: "Course → players → tees"
  },
  {
    id: "games",
    title: "Pick the games",
    caption: "Skins. Nassau. Best Ball. 2-Man. Wolf. Quota. One-tap a Quick-Start package or build your own — the wagers and rules fill themselves in.",
    hint: "Tap a package to apply"
  },
  {
    id: "wagers",
    title: "Set the stakes. Lock it in.",
    caption: "Every player sees the wager sheet on their phone and taps to confirm. Their score-entry stays locked until they do — no \"I didn't know\" excuses.",
    hint: "Each handshake is recorded"
  },
  {
    id: "scoring",
    title: "Score with one thumb",
    caption: "Big tap targets, swipe between holes, instant outcome label, strokes shown right on the hole. Your team partner's score for the hole is right there too.",
    hint: "Try the +/- or the chip rail"
  },
  {
    id: "leaderboard",
    title: "Watch the standings move",
    caption: "Scores propagate to every phone the second they're entered. Skins fall, Nassau matches close, side bets settle — all live.",
    hint: "Toggle Gross / Net / Skins / Team / Bets"
  },
  {
    id: "settle",
    title: "Settle up before you leave the parking lot",
    caption: "Final tally is one screen. Each line opens Venmo with the right amount pre-filled. Season ledger logs it for the year-end leader.",
    hint: "Tap Pay to open Venmo"
  },
  {
    id: "cta",
    title: "Your Saturday game, finally organized.",
    caption: "Built for member games, regular groups, and small club events. Every press, payout, and skin handled automatically.",
    hint: "Free to set up"
  }
];

export default function DemoTour() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const total = STEPS.length;
  const current = STEPS[step];

  // Auto-advance
  useEffect(() => {
    if (!auto) return;
    if (step >= total - 1) return;
    const t = setTimeout(() => setStep((s) => Math.min(total - 1, s + 1)), 8500);
    return () => clearTimeout(t);
  }, [auto, step, total]);

  function next() {
    setStep((s) => Math.min(total - 1, s + 1));
  }
  function prev() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div className="space-y-6 pb-32 sm:pb-8">
      {/* Progress + controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-400 shrink-0">
            Step {step + 1} of {total}
          </div>
          <div className="hidden sm:block flex-1 h-[3px] bg-cream-100/10 rounded-full overflow-hidden max-w-[280px]">
            <div
              className="h-full bg-gold-500 transition-all duration-500"
              style={{ width: `${((step + 1) / total) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setAuto((a) => !a)} className="btn-ghost text-xs">
            {auto ? "⏸ Pause" : "▶ Auto"}
          </button>
          <Link href="/demo/round" className="btn-ghost text-xs hidden sm:inline-flex">
            Skip the tour
          </Link>
        </div>
      </div>

      {/* Title + caption */}
      <header className="space-y-2 max-w-3xl">
        <h1 className="font-serif text-3xl sm:text-5xl text-cream-50 leading-[1.05]">{current.title}</h1>
        <p className="text-cream-100/70 sm:text-lg leading-relaxed">{current.caption}</p>
        {current.hint && (
          <p className="text-[11px] uppercase tracking-[0.22em] text-gold-400">{current.hint}</p>
        )}
      </header>

      {/* Visual stage */}
      <div className="rounded-2xl bg-grain border border-cream-100/10 bg-brand-900/40 p-4 sm:p-6">
        {current.id === "hero" && <HeroStage />}
        {current.id === "setup" && <SetupStage />}
        {current.id === "games" && <GamesStage />}
        {current.id === "wagers" && <WagersStage />}
        {current.id === "scoring" && <ScoringStage />}
        {current.id === "leaderboard" && <LeaderboardStage active={current.id === STEPS[step].id} />}
        {current.id === "settle" && <SettleStage />}
        {current.id === "cta" && <CtaStage />}
      </div>

      {/* Sticky bottom controls on mobile, inline on desktop. Pad the
          bottom for the iPhone home indicator + 5rem clearance for
          the demo's own bottom nav. Audit + chaos QA 2026-05-12. */}
      <div
        className="fixed inset-x-0 sm:static sm:bottom-auto px-4 sm:px-0"
        style={{
          bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))"
        }}
      >
        <div className="max-w-5xl mx-auto flex gap-2">
          <button className="btn-secondary flex-1" disabled={step === 0} onClick={prev}>
            ← Prev
          </button>
          {step < total - 1 ? (
            <button className="btn-primary flex-1" onClick={next}>
              Next →
            </button>
          ) : (
            <Link className="btn-primary flex-1 text-center" href="/signup">
              Get started — sign up free →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Stages ───────────────────────────────────────────────────────────── */

function HeroStage() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-center">
      <div>
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-400">Saturday Crew</div>
        <h3 className="font-serif text-2xl sm:text-3xl text-cream-50 mt-1">JGCC, 18 holes</h3>
        <p className="text-sm text-cream-100/65 mt-2">
          Cruz, Jeff, Marco, Taylor — the Saturday group. Friendly Nassau, net skins, $10 best ball.
          We&apos;ll set it up, score it, and settle it.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 max-w-sm">
          {DEMO_PLAYERS.map((p) => (
            <div key={p.id} className="surface rounded-xl px-3 py-2 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-800 text-cream-50 font-serif flex items-center justify-center text-sm">
                {p.display_name[0]}
              </div>
              <div className="min-w-0">
                <div className="text-cream-50 text-sm truncate">{p.display_name}</div>
                <div className="text-[10px] text-cream-100/55">HI {p.handicap_index_used}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Today's bets</div>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex justify-between"><span className="text-cream-100/85">Friendly Nassau</span><span className="font-serif text-cream-50">$5 / $5 / $10</span></li>
          <li className="flex justify-between"><span className="text-cream-100/85">Net Skins</span><span className="font-serif text-cream-50">$1 / skin</span></li>
          <li className="flex justify-between"><span className="text-cream-100/85">2-man Best Ball</span><span className="font-serif text-cream-50">$10</span></li>
        </ul>
      </div>
    </div>
  );
}

function SetupStage() {
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Course</div>
        <div className="mt-1 font-serif text-xl text-cream-50">Jacksonville Golf & Country Club</div>
        <div className="text-xs text-cream-100/55 mt-0.5">Black 73.2/138 · Gold 71.8/133 · Silver 70.6/120 · Jade 67.8/117 · Cranberry 70.4/125</div>
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.28em] mb-2">
          <span className="text-gold-400">Players</span>
          <span className="text-cream-100/45">4 picked</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DEMO_PLAYERS.map((p) => (
            <div key={p.id} className="surface rounded-xl px-3 py-2 flex items-center justify-between gap-3 ring-1 ring-gold-500/40">
              <div className="min-w-0">
                <div className="font-medium text-cream-50 truncate">{p.display_name}</div>
                <div className="text-xs text-cream-100/55">HI {p.handicap_index_used}</div>
              </div>
              <span className="text-xs text-gold-400 shrink-0">Black</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card p-3 border-dashed border-2 border-cream-100/15 text-center text-sm text-cream-100/55">
        + Add a guest player on the fly (no account needed)
      </div>
    </div>
  );
}

function GamesStage() {
  const packages = [
    { emoji: "🤝", label: "Gentleman's bet", desc: "$5 individual net" },
    { emoji: "⛳", label: "Friendly Nassau", desc: "$5/5/10 match play" },
    { emoji: "🔥", label: "Aggressive Nassau", desc: "$10/10/20 + auto-press" },
    { emoji: "🍀", label: "Quarter skins", desc: "Net skins, doubling" },
    { emoji: "🍁", label: "Canadian skins", desc: "Birdie validates" },
    { emoji: "♣", label: "Three-way", desc: "Net + best ball + skins", featured: true },
    { emoji: "🏆", label: "Members' day", desc: "Aggregate + CTP pot" }
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {packages.map((p) => (
        <div
          key={p.label}
          className={`card p-4 transition-colors ${
            p.featured ? "ring-2 ring-gold-500 bg-brand-800/70" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{p.emoji}</span>
            <span className="font-serif text-cream-50 text-base">{p.label}</span>
            {p.featured && (
              <span className="ml-auto text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Selected
              </span>
            )}
          </div>
          <p className="text-xs text-cream-100/65 mt-1">{p.desc}</p>
        </div>
      ))}
    </div>
  );
}

function WagersStage() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">The book</div>
        <ul className="mt-3 divide-y divide-cream-100/10 text-sm">
          <li className="py-3 flex items-center justify-between">
            <span className="text-cream-100/85">Friendly Nassau<br /><span className="text-xs text-cream-100/55">F $5 / B $5 / O $10 · match play</span></span>
            <span className="font-serif text-2xl text-gold-500">$5+</span>
          </li>
          <li className="py-3 flex items-center justify-between">
            <span className="text-cream-100/85">Net Skins<br /><span className="text-xs text-cream-100/55">$1/skin · split on tie · linear carry</span></span>
            <span className="font-serif text-2xl text-gold-500">$1</span>
          </li>
          <li className="py-3 flex items-center justify-between">
            <span className="text-cream-100/85">2-man Best Ball<br /><span className="text-xs text-cream-100/55">$10 · 85% hcp allowance</span></span>
            <span className="font-serif text-2xl text-gold-500">$10</span>
          </li>
        </ul>
      </div>
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Handshakes</div>
        <ul className="mt-3 space-y-2 text-sm">
          {DEMO_PLAYERS.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between">
              <span className="text-cream-50">{p.display_name}</span>
              {i < 3 ? (
                <span className="pill-live">✓ Confirmed</span>
              ) : (
                <span className="pill-draft">Pending</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-cream-100/55 mt-3">
          Score-entry stays locked for any player who hasn&apos;t tapped &quot;I&apos;m in.&quot;
        </p>
      </div>
    </div>
  );
}

function ScoringStage() {
  // Embed a simplified ScorePad demo with Cruz mid-round. We show the first 6 holes
  // played, focused on hole 7.
  const player = DEMO_PLAYERS[0];
  const strokes = strokesPerHole(player.playing_handicap, DEMO_HOLES);
  const initial: Record<number, number | null> = {};
  for (const h of DEMO_HOLES) initial[h.hole_number] = null;
  for (const s of DEMO_SCORES) {
    if (s.round_player_id === player.id && s.gross != null && s.hole_number <= 6) {
      initial[s.hole_number] = s.gross;
    }
  }
  const [scores, setScores] = useState(initial);

  const partner = DEMO_PLAYERS.find((p) => p.id === "rp-marco")!;
  const partnerScores: Record<number, number | null> = {};
  for (const h of DEMO_HOLES) partnerScores[h.hole_number] = null;
  for (const s of DEMO_SCORES) {
    if (s.round_player_id === partner.id && s.gross != null && s.hole_number <= 6) {
      partnerScores[s.hole_number] = s.gross;
    }
  }

  return (
    <ScorePad
      playerName={player.display_name}
      playingHandicap={player.playing_handicap}
      holes={DEMO_HOLES}
      scores={scores}
      strokes={strokes}
      initialHole={7}
      onSave={(hole, gross) => setScores((s) => ({ ...s, [hole]: gross }))}
      team={{
        name: "Team 1 (Cruz · Marco)",
        partners: [{ display_name: partner.display_name, scores: partnerScores }],
        mode: "best_ball"
      }}
    />
  );
}

function LeaderboardStage({ active }: { active: boolean }) {
  // Simulate progressive score updates while this stage is active
  const [extra, setExtra] = useState<Record<string, Record<number, number | null>>>({});
  const tick = useRef(0);

  useEffect(() => {
    if (!active) return;
    const playerOrder = ["rp-jeff", "rp-cruz", "rp-marco", "rp-taylor"];
    const par15 = 4, par16 = 5, par17 = 3, par18 = 4;
    const additions: Array<{ rp: string; hole: number; gross: number }> = [
      { rp: "rp-cruz",   hole: 15, gross: par15 + 1 },
      { rp: "rp-jeff",   hole: 15, gross: par15 },
      { rp: "rp-marco",  hole: 15, gross: par15 + 2 },
      { rp: "rp-taylor", hole: 15, gross: par15 + 1 },
      { rp: "rp-jeff",   hole: 16, gross: par16 },
      { rp: "rp-cruz",   hole: 16, gross: par16 + 1 },
      { rp: "rp-taylor", hole: 16, gross: par16 + 1 },
      { rp: "rp-marco",  hole: 16, gross: par16 + 2 }
    ];
    const id = setInterval(() => {
      const next = additions[tick.current];
      if (!next) {
        clearInterval(id);
        return;
      }
      setExtra((prev) => ({
        ...prev,
        [next.rp]: { ...(prev[next.rp] ?? {}), [next.hole]: next.gross }
      }));
      tick.current += 1;
    }, 1100);
    return () => clearInterval(id);
  }, [active]);

  const merged = useMemo(() => {
    return DEMO_SCORES.map((s) => {
      const override = extra[s.round_player_id]?.[s.hole_number];
      return override != null ? { ...s, gross: override } : s;
    }).concat(
      Object.entries(extra).flatMap(([rp, holes]) =>
        Object.entries(holes)
          .filter(
            ([h]) =>
              !DEMO_SCORES.find(
                (x) => x.round_player_id === rp && x.hole_number === Number(h)
              )
          )
          .map(([h, g]) => ({ round_player_id: rp, hole_number: Number(h), gross: g as number }))
      )
    );
  }, [extra]);

  const sheets = DEMO_PLAYERS.map((p) => buildPlayerSheet(p, merged, DEMO_HOLES));
  const [tab, setTab] = useState<LeaderboardTab>("net");
  const mode = tab === "gross" ? "gross" : "net";
  const board = buildBoard(sheets, mode);

  const par = DEMO_HOLES.reduce((s, h) => s + h.par, 0);
  const labelByPlayer = new Map(DEMO_PLAYERS.map((p) => [p.id, p.display_name]));
  const skinsOut = settleGame({
    game: DEMO_GAMES.find((g) => g.game_type === "skins_net")!,
    players: DEMO_PLAYERS,
    scores: merged,
    course: { holes: DEMO_HOLES, par }
  });

  return (
    <Leaderboard
      courseName="Black tee · 18 holes"
      date="Today"
      status="live"
      rows={board}
      tab={tab}
      onTabChange={setTab}
      alternateContent={
        tab === "skins" ? (
          <ul className="divide-y divide-slate-100">
            {skinsOut.highlights.length === 0 ? (
              <li className="py-3 text-sm text-slate-500">No skins yet.</li>
            ) : (
              skinsOut.highlights.map((h, i) => (
                <li key={i} className="py-2.5 flex justify-between text-sm">
                  <span className="text-slate-600">Hole {h.hole}</span>
                  <span className="text-slate-900 font-medium">{h.label}</span>
                </li>
              ))
            )}
          </ul>
        ) : (
          <div className="text-slate-500 text-sm py-6 text-center">
            Tab {tab} populates from the same engine — try Gross / Net in the live demo.
          </div>
        )
      }
    />
  );
}

function SettleStage() {
  // Generate the clubhouse recap from the actual demo round data.
  const recap = generateRecap({
    players: DEMO_PLAYERS,
    scores: DEMO_SCORES,
    holes: DEMO_HOLES,
    games: DEMO_GAMES
  });

  const rows = Object.values(DEMO_PROFILES)
    .map((p) => ({ name: p.display_name, net: p.season_net_cents, venmo: p.venmo_handle }))
    .sort((a, b) => b.net - a.net);

  const balances = rows.map((r) => ({ ...r, v: r.net }));
  const flows: Array<{ from: string; to: string; venmo: string; amount: number }> = [];
  while (true) {
    balances.sort((a, b) => a.v - b.v);
    const debtor = balances[0];
    const creditor = balances[balances.length - 1];
    if (!debtor || !creditor || debtor.v >= 0 || creditor.v <= 0) break;
    const amt = Math.min(-debtor.v, creditor.v);
    flows.push({ from: debtor.name, to: creditor.name, venmo: creditor.venmo, amount: amt });
    debtor.v += amt;
    creditor.v -= amt;
  }

  return (
    <div className="space-y-4">
      {recap.length > 0 && <SmackTalk moments={recap} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Final standings</div>
        <ul className="mt-3 divide-y divide-cream-100/10 text-sm">
          {rows.map((r, i) => (
            <li key={r.name} className="py-2.5 flex items-center justify-between">
              <span className="flex items-center gap-3">
                <span className="font-serif text-gold-500 tabular-nums w-6">{i + 1}</span>
                <span className="text-cream-50">{r.name}</span>
              </span>
              <span
                className={`font-serif tabular-nums ${
                  r.net > 0 ? "text-emerald-300" : r.net < 0 ? "text-red-400" : "text-cream-100/65"
                }`}
              >
                {r.net > 0 ? "+" : r.net < 0 ? "−" : ""}${(Math.abs(r.net) / 100).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-5">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Settle up</div>
        <ul className="mt-3 space-y-2 text-sm">
          {flows.map((f, i) => (
            <li
              key={i}
              className="surface rounded-xl px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <span>
                <span className="font-medium text-cream-50">{f.from}</span>
                <span className="text-cream-100/45 mx-2">→</span>
                <span className="font-medium text-cream-50">{f.to}</span>
              </span>
              <a
                className="btn-primary text-xs"
                href={`https://venmo.com/${f.venmo}?txn=pay&amount=${(f.amount / 100).toFixed(2)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Pay ${(f.amount / 100).toFixed(2)}
              </a>
            </li>
          ))}
        </ul>
      </div>
      </div>
    </div>
  );
}

function CtaStage() {
  return (
    <div className="text-center py-6">
      <p className="text-[10px] uppercase tracking-[0.32em] text-gold-400">You're set</p>
      <h3 className="font-serif text-3xl sm:text-4xl text-cream-50 mt-2">
        Sign up. Add your group. Tee it up.
      </h3>
      <p className="text-cream-100/65 mt-3 max-w-xl mx-auto">
        Free to set up. No app to install — works in any phone browser. PWA-installable for one-tap launch on the cart.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        <Link href="/signup" className="btn-primary">Get started — free sign up →</Link>
        <Link href="/demo/round" className="btn-secondary">Keep poking around</Link>
      </div>
    </div>
  );
}
