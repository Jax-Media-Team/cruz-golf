"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Interactive onboarding tour — a 60-90 second mobile-first walkthrough
 * that drops the user into a simulated round and shows them every key
 * surface (game pick, score entry, leaderboard movement, skins, settle,
 * record book, share). Personalized with their first name.
 *
 * Lives in the dashboard layout. Auto-shows once for new users (no
 * finalized rounds, no tour-completed flag), can be replayed any time
 * via the dashboard "Take the tour" button.
 *
 * Why not redirect to /demo? Because /demo lives on a separate route
 * with its own layout. Bouncing the user out of their dashboard breaks
 * the "this is YOUR app" feeling. The tour stays in-place: a full-screen
 * overlay with sample data + animated transitions between scenes.
 */

const STORAGE_KEY = "cruz-golf:tour:completed";

type Scene = {
  id: string;
  title: string;
  caption: string;
  hint?: string;
  /** Visual stage — receives the user's first name + scene-tick props. */
  render: (ctx: SceneContext) => React.ReactNode;
};

type SceneContext = {
  firstName: string;
  /** 0..1 progress within the current scene (drives animations). */
  tick: number;
};

function firstNameOf(full: string | null | undefined): string {
  if (!full) return "you";
  const t = full.trim().split(/\s+/)[0];
  return t.length > 0 ? t : "you";
}

const SCENES: Scene[] = [
  {
    id: "welcome",
    title: "Welcome — let's set up a round in 60 seconds.",
    caption:
      "Cruz Golf runs your Saturday foursome end-to-end: scoring, side games, settlement on Venmo. Quick tour so you know where everything lives.",
    hint: "Tap Next ↓",
    render: ({ firstName }) => (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-center">
        <div>
          <p className="h-eyebrow text-gold-400">Saturday crew</p>
          <h3 className="font-serif text-2xl sm:text-3xl text-cream-50 mt-1">JGCC, 18 holes</h3>
          <p className="text-sm text-cream-100/65 mt-2">
            {firstName}, Jeff, Marco, Taylor — the regular four. We&apos;ll set up a
            round, score it, and settle it.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[firstName, "Jeff", "Marco", "Taylor"].map((name, i) => (
              <div key={i} className="surface rounded-xl px-3 py-2 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-800 text-cream-50 font-serif flex items-center justify-center text-sm">
                  {name[0]}
                </div>
                <div className="text-cream-50 text-sm truncate">{name}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <p className="h-eyebrow text-gold-400">Today&apos;s bets</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-cream-100/85">Skins (net)</span>
              <span className="font-serif text-cream-50">$20 buy-in</span>
            </li>
            <li className="flex justify-between">
              <span className="text-cream-100/85">Nassau</span>
              <span className="font-serif text-cream-50">$5/5/10</span>
            </li>
            <li className="flex justify-between">
              <span className="text-cream-100/85">Best ball</span>
              <span className="font-serif text-cream-50">$10</span>
            </li>
          </ul>
        </div>
      </div>
    )
  },
  {
    id: "games",
    title: "Pick the games + stakes.",
    caption:
      "One picker per family — Individual, Skins, Nassau, Best Ball, Scramble, 6-6-6. Pot-based skins are the default with a $20 buy-in. Your last setup is one tap away as a saved preset.",
    hint: "/rounds/new in the real app",
    render: () => (
      <div className="space-y-2">
        {[
          { emoji: "🍀", label: "Skins", desc: "$20 buy-in · ties carry · pot-based", picked: true },
          { emoji: "⛳", label: "Nassau", desc: "$5 / $5 / $10 · presses on", picked: true },
          { emoji: "🤝", label: "Best ball (net)", desc: "$10 · 85% allowance · 2-man teams", picked: true },
          { emoji: "👤", label: "Individual (net)", desc: "$10 · lowest net wins" }
        ].map((g) => (
          <div
            key={g.label}
            className={`card p-4 flex items-center gap-3 ${
              g.picked ? "border border-gold-500/40 bg-brand-900/40" : ""
            }`}
          >
            <span className="text-2xl">{g.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="font-serif text-cream-50 text-base">{g.label}</div>
              <div className="text-xs text-cream-100/65">{g.desc}</div>
            </div>
            {g.picked && (
              <span className="pill bg-gold-500 text-brand-900 text-[10px] px-2 py-0.5">Picked</span>
            )}
          </div>
        ))}
      </div>
    )
  },
  {
    id: "scoring",
    title: "Score with one thumb.",
    caption:
      "Tap +/− or pick a number. The scorepad starts at par for everyone — strokes only affect your net total, not the gross input. Yellow dots show whose handicap kicks in on which holes.",
    hint: "Try the chip rail below",
    render: ({ firstName, tick }) => {
      const reveal = (n: number) => tick > n / 5;
      return (
        <div className="space-y-3">
          {[
            { name: firstName, par: 4, score: reveal(0) ? 4 : null, strokes: 1, label: "PAR" },
            { name: "Jeff", par: 4, score: reveal(1) ? 3 : null, strokes: 0, label: "BIRDIE" },
            { name: "Marco", par: 4, score: reveal(2) ? 5 : null, strokes: 1, label: "BOGEY" },
            { name: "Taylor", par: 4, score: reveal(3) ? 4 : null, strokes: 0, label: "PAR" }
          ].map((p) => (
            <div key={p.name} className="card p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-cream-50">{p.name}</span>
                  {p.strokes > 0 && (
                    <span className="inline-flex items-center gap-0.5" title="Receives a stroke on this hole">
                      <span className="w-2 h-2 rounded-full bg-gold-500" />
                    </span>
                  )}
                </div>
                {p.score != null && (
                  <div
                    className={`text-[10px] uppercase tracking-[0.28em] mt-0.5 ${
                      p.label === "BIRDIE"
                        ? "text-red-400"
                        : p.label === "PAR"
                        ? "text-cream-50"
                        : "text-cream-100/55"
                    }`}
                  >
                    {p.label}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn bg-brand-900/70 border border-cream-100/15 text-cream-50 w-9 h-9">
                  −
                </button>
                <div
                  className="font-serif tabular-nums text-cream-50 text-center"
                  style={{ fontSize: 30, lineHeight: 1, width: 40 }}
                >
                  {p.score ?? <span className="text-cream-100/30">·</span>}
                </div>
                <button className="btn bg-gold-500 text-brand-900 w-9 h-9">+</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
  },
  {
    id: "leaderboard",
    title: "Watch the standings move live.",
    caption:
      "Every score on every phone updates the leaderboard within a second. Toggle Gross / Net / Skins / Bets — it's all from the same engine, all zero-sum.",
    hint: "Live · Net selected",
    render: ({ firstName }) => (
      <div className="space-y-2">
        <div className="flex gap-1 mb-2">
          {["Gross", "Net", "Skins", "Bets"].map((t, i) => (
            <span
              key={t}
              className={`pill text-[10px] px-3 py-1 ${
                i === 1 ? "bg-gold-500 text-brand-900" : "bg-brand-900/60 text-cream-100/70"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
        {[
          { name: "Jeff", net: 70, vs: -2 },
          { name: firstName, net: 73, vs: 1 },
          { name: "Taylor", net: 75, vs: 3 },
          { name: "Marco", net: 78, vs: 6 }
        ].map((p, i) => (
          <div key={p.name} className="card p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-serif text-gold-500 tabular-nums w-5">{i + 1}</span>
              <span className="text-cream-50">{p.name}</span>
            </div>
            <div className="flex items-baseline gap-3 tabular-nums">
              <span className="text-sm text-cream-100/65">
                {p.vs >= 0 ? "+" : ""}
                {p.vs}
              </span>
              <span className="font-serif text-2xl text-cream-50">{p.net}</span>
            </div>
          </div>
        ))}
      </div>
    )
  },
  {
    id: "settle",
    title: "Settle up before you leave the lot.",
    caption:
      "We net every bet across every game and find the fewest Venmo transfers. Tap a row to open Venmo with the amount pre-filled.",
    hint: "Minimum-flow settlement",
    render: ({ firstName }) => (
      <div className="space-y-2">
        {[
          { from: "Marco", to: "Jeff", amount: 22, venmo: "jeff-saturday" },
          { from: "Marco", to: firstName, amount: 8, venmo: firstName.toLowerCase() },
          { from: "Taylor", to: "Jeff", amount: 5, venmo: "jeff-saturday" }
        ].map((f, i) => (
          <div key={i} className="card p-3 flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className="font-medium text-cream-50">{f.from}</span>
              <span className="text-cream-100/45 mx-2">→</span>
              <span className="font-medium text-cream-50">{f.to}</span>
            </span>
            <span className="btn-primary text-xs">Pay ${f.amount}.00</span>
          </div>
        ))}
        <p className="text-[11px] text-cream-100/55 mt-2">
          Each row opens Venmo with the right handle and amount already filled in.
        </p>
      </div>
    )
  },
  {
    id: "record-book",
    title: "Three record books to brag with.",
    caption:
      "Group records (your friends), Personal (just you), and per-Course. Lowest gross, biggest single-round win, most birdies in a round, season net — they all keep updating as you finish more rounds.",
    hint: "/records · /records/me · /records/course/[id]",
    render: ({ firstName }) => (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="h-eyebrow text-gold-400">🏆 Lowest gross (18)</p>
          <ol className="mt-2 text-sm divide-y divide-cream-100/8">
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">Jeff</span><span className="font-serif tabular-nums">71</span></li>
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">{firstName}</span><span className="font-serif tabular-nums">74</span></li>
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">Taylor</span><span className="font-serif tabular-nums">79</span></li>
          </ol>
        </div>
        <div className="card p-4">
          <p className="h-eyebrow text-gold-400">💰 Biggest single-round win</p>
          <ol className="mt-2 text-sm divide-y divide-cream-100/8">
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">Jeff</span><span className="font-serif tabular-nums text-emerald-300">+$45</span></li>
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">{firstName}</span><span className="font-serif tabular-nums text-emerald-300">+$22</span></li>
            <li className="py-1.5 flex justify-between"><span className="text-cream-50">Taylor</span><span className="font-serif tabular-nums text-emerald-300">+$8</span></li>
          </ol>
        </div>
      </div>
    )
  },
  {
    id: "share",
    title: "Share the leaderboard or take it home.",
    caption:
      "One Share button: native share sheet on phone, copy link, download the leaderboard as an image. Spectator link works for anyone — no Cruz Golf account needed.",
    hint: "Share is on every round page",
    render: () => (
      <div className="space-y-2 max-w-md mx-auto">
        {[
          { emoji: "📤", label: "Share leaderboard", desc: "Open your phone's share menu (text, group, social)" },
          { emoji: "🔗", label: "Copy link", desc: "Paste it anywhere — read-only spectator view" },
          { emoji: "⬇️", label: "Download image", desc: "PNG of the final standings, ready for the group chat" }
        ].map((o) => (
          <div key={o.label} className="card p-3 flex items-center gap-3">
            <span className="text-2xl">{o.emoji}</span>
            <div>
              <div className="font-serif text-sm text-cream-50">{o.label}</div>
              <p className="text-[11px] text-cream-100/55">{o.desc}</p>
            </div>
          </div>
        ))}
      </div>
    )
  },
  {
    id: "ready",
    title: "You're set.",
    caption:
      "From here: add your players, pick a course (or import a scorecard photo), start a round. Take the tour again any time from the dashboard.",
    hint: "Ready when you are",
    render: ({ firstName }) => (
      <div className="text-center py-6">
        <div className="text-5xl">⛳</div>
        <h3 className="font-serif text-2xl sm:text-3xl text-cream-50 mt-3">
          Tee it up, {firstName}.
        </h3>
        <p className="text-cream-100/65 mt-2 max-w-xl mx-auto">
          Add your crew → pick a course → start a round. The first one is always
          the slowest — every Saturday after that is one tap.
        </p>
      </div>
    )
  }
];

const PER_SCENE_MS = 7500;

export function OnboardingTour({
  displayName,
  initiallyOpen = false,
  startVariant = "first-visit",
  eligibleForAutoShow = true
}: {
  displayName: string | null;
  initiallyOpen?: boolean;
  startVariant?: "first-visit" | "manual";
  /** Set to false on dashboards where the user has already played — we
   *  don't want to interrupt veterans even if they cleared localStorage. */
  eligibleForAutoShow?: boolean;
}) {
  const firstName = useMemo(() => firstNameOf(displayName), [displayName]);
  const [open, setOpen] = useState(initiallyOpen);
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const tickRef = useRef<number | null>(null);

  // First-visit auto-open: only show if not previously completed AND the
  // host page says the user is eligible (e.g., still on first round).
  useEffect(() => {
    if (initiallyOpen) return;
    if (!eligibleForAutoShow) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
      const t = window.setTimeout(() => setOpen(true), 800);
      return () => window.clearTimeout(t);
    } catch {
      /* localStorage disabled */
    }
  }, [initiallyOpen, eligibleForAutoShow]);

  // Auto-advance + per-scene tick (drives the scoring scene reveal).
  useEffect(() => {
    if (!open || !auto) return;
    const start = Date.now();
    setTick(0);
    function loop() {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / PER_SCENE_MS);
      setTick(t);
      if (t >= 1) {
        if (step < SCENES.length - 1) setStep((s) => s + 1);
        else setAuto(false);
        return;
      }
      tickRef.current = window.requestAnimationFrame(loop);
    }
    tickRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (tickRef.current) window.cancelAnimationFrame(tickRef.current);
    };
  }, [open, auto, step]);

  // Lock body scroll while the tour is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function close(remember = true) {
    setOpen(false);
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  }

  function next() {
    setAuto(false);
    setStep((s) => Math.min(SCENES.length - 1, s + 1));
  }
  function prev() {
    setAuto(false);
    setStep((s) => Math.max(0, s - 1));
  }

  if (!open) return null;

  const scene = SCENES[step];
  const isLast = step === SCENES.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-brand-950/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="Cruz Golf onboarding tour"
    >
      {/* Top bar — progress + skip */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-cream-100/10">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-[0.28em] text-gold-400 shrink-0">
            Tour {step + 1} / {SCENES.length}
          </span>
          <div className="flex-1 max-w-xs h-[3px] bg-cream-100/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gold-500 transition-all duration-300"
              style={{
                width: `${((step + (auto ? tick : 1)) / SCENES.length) * 100}%`
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAuto((a) => !a)}
            className="btn-ghost text-xs"
            aria-label={auto ? "Pause tour" : "Resume tour"}
          >
            {auto ? "⏸" : "▶"}
          </button>
          <button onClick={() => close(true)} className="btn-ghost text-xs">
            {startVariant === "first-visit" ? "Skip" : "Close"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 sm:py-8">
        <div className="max-w-3xl mx-auto space-y-5">
          <header className="space-y-2">
            <h1 className="font-serif text-2xl sm:text-4xl text-cream-50 leading-tight">
              {scene.title}
            </h1>
            <p className="text-cream-100/75 sm:text-lg leading-relaxed">{scene.caption}</p>
            {scene.hint && (
              <p className="text-[11px] uppercase tracking-[0.22em] text-gold-400">
                {scene.hint}
              </p>
            )}
          </header>

          {/* Stage */}
          <div className="rounded-2xl border border-cream-100/10 bg-brand-900/30 p-4 sm:p-6">
            {scene.render({ firstName, tick })}
          </div>
        </div>
      </div>

      {/* Bottom controls — always visible */}
      <div
        className="border-t border-cream-100/10 px-4 sm:px-6 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            onClick={prev}
            disabled={step === 0}
            className="btn-secondary flex-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          {!isLast ? (
            <button onClick={next} className="btn-primary flex-[2]">
              Next →
            </button>
          ) : (
            <Link
              href="/players"
              onClick={() => close(true)}
              className="btn-primary flex-[2] text-center"
            >
              Add my players →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Small "Take the tour" trigger button. Lives on the dashboard so users
 * who skipped it on first visit can replay any time.
 */
export function ReplayTourButton({ displayName }: { displayName: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen(true)}
        aria-label="Take the Cruz Golf tour"
      >
        🎬 Tour the app
      </button>
      {open && (
        <OnboardingTour
          displayName={displayName}
          initiallyOpen
          startVariant="manual"
        />
      )}
    </>
  );
}
