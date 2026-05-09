"use client";
import { useState } from "react";
import type { CourseHole } from "@/lib/types";

type Partner = {
  display_name: string;
  scores: Record<number, number | null>;
};

type Props = {
  playerName: string;
  playingHandicap: number;
  holes: CourseHole[];
  scores: Record<number, number | null>;
  /** Strokes received per hole, in hole-order (index 0 = hole 1, etc). */
  strokes: number[];
  initialHole?: number;
  /** Called when a score is set. Promise so callers can show busy state. */
  onSave: (holeNumber: number, gross: number) => void | Promise<void>;
  /** Optional: live team standings for the current hole. */
  team?: {
    name: string;
    partners: Partner[];
    /** "best_ball" → lower of partners; "aggregate" → sum. */
    mode?: "best_ball" | "aggregate";
  };
};

function outcome(diff: number): { label: string; tone: "red" | "white" | "muted" | "muted-2" } {
  if (diff <= -3) return { label: "ALBATROSS", tone: "red" };
  if (diff === -2) return { label: "EAGLE", tone: "red" };
  if (diff === -1) return { label: "BIRDIE", tone: "red" };
  if (diff === 0) return { label: "PAR", tone: "white" };
  if (diff === 1) return { label: "BOGEY", tone: "muted" };
  if (diff === 2) return { label: "DOUBLE", tone: "muted-2" };
  return { label: `+${diff}`, tone: "muted-2" };
}

export function ScorePad({
  playerName,
  playingHandicap,
  holes,
  scores,
  strokes,
  initialHole,
  onSave,
  team
}: Props) {
  const ordered = [...holes].sort((a, b) => a.hole_number - b.hole_number);
  const firstHole = ordered[0]?.hole_number ?? 1;
  const lastHole = ordered[ordered.length - 1]?.hole_number ?? 18;
  const firstEmpty = ordered.find((h) => scores[h.hole_number] == null)?.hole_number ?? firstHole;

  const [hole, setHole] = useState(initialHole ?? firstEmpty);

  const current = ordered.find((h) => h.hole_number === hole) ?? ordered[0];
  const idx = ordered.findIndex((h) => h.hole_number === current.hole_number);
  const strokesThisHole = strokes[idx] ?? 0;
  const score = scores[current.hole_number] ?? null;
  const out = score != null ? outcome(score - current.par) : null;

  async function set(next: number) {
    if (next < 1) return;
    await onSave(current.hole_number, next);
    // No auto-advance — user controls hole navigation with Next →.
  }

  // Swipe-to-change-hole was REMOVED. The handlers were on the same card
  // that holds the +/- buttons; tapping a button with any finger drift
  // > 50px (very normal on mobile) was firing setHole and jumping the
  // user to a different hole mid-tap. Use the Prev/Next buttons instead.

  // Team aggregate for the current hole
  const teamForHole = (() => {
    if (!team) return null;
    const playerScore = score ?? null;
    const partnerScores = team.partners.map((p) => p.scores[current.hole_number] ?? null);
    const all = [playerScore, ...partnerScores].filter((v): v is number => v != null);
    if (all.length === 0) return null;
    const value = team.mode === "aggregate" ? all.reduce((s, v) => s + v, 0) : Math.min(...all);
    return value;
  })();

  const expected = current.par + strokesThisHole;

  return (
    <div className="space-y-4 select-none">
      {/* Top context */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.28em] text-cream-100/50">Scoring</div>
          <div className="font-serif text-2xl sm:text-3xl text-cream-50 leading-tight truncate">
            {playerName}
          </div>
          <div className="text-xs text-cream-100/55 mt-0.5">PH {playingHandicap}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">
            Hole {current.hole_number}
          </div>
          <div className="font-serif text-3xl sm:text-4xl text-cream-50 leading-tight tabular-nums">
            Par {current.par}
          </div>
          <div className="text-xs text-cream-100/60 mt-0.5 flex items-center justify-end gap-2">
            <span>SI {current.stroke_index}</span>
            {strokesThisHole > 0 && (
              <span className="inline-flex items-center gap-1 text-gold-400">
                {Array.from({ length: Math.min(strokesThisHole, 3) }, (_, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-gold-500" />
                ))}
                <span className="ml-0.5">+{strokesThisHole}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hole strip */}
      <div className="overflow-x-auto -mx-4 px-4 pb-1">
        <div className="flex gap-1.5 min-w-max">
          {ordered.map((h, i) => {
            const sc = scores[h.hole_number];
            const active = h.hole_number === current.hole_number;
            const st = strokes[i] ?? 0;
            const diff = sc != null ? sc - h.par : null;
            return (
              <button
                key={h.hole_number}
                onClick={() => setHole(h.hole_number)}
                className={`relative px-2 pt-2 pb-1.5 min-w-[48px] rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-gold-500 text-brand-900 shadow-soft"
                    : sc != null
                    ? "bg-brand-700/70 text-cream-50"
                    : "bg-brand-900/60 border border-cream-100/12 text-cream-100/65"
                }`}
              >
                <div className="font-medium tabular-nums leading-none">{h.hole_number}</div>
                <div
                  className={`text-[10px] tabular-nums mt-0.5 leading-none ${
                    active
                      ? "text-brand-900/70"
                      : sc != null
                      ? diff != null && diff < 0
                        ? "text-red-300"
                        : "text-cream-100/65"
                      : "text-cream-100/40"
                  }`}
                >
                  {sc != null ? sc : `· ${h.par}`}
                </div>
                {st > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${
                      active ? "bg-brand-900" : "bg-gold-500"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Score area */}
      <div className="card p-6 sm:p-8 text-center relative overflow-hidden">
        <div className="flex items-center justify-center gap-5 sm:gap-8">
          <button
            className="btn bg-brand-900/70 border border-cream-100/15 text-cream-50 w-16 h-16 sm:w-20 sm:h-20 text-3xl active:scale-95 transition-transform"
            onClick={() => set(Math.max(1, (score ?? expected) - 1))}
            aria-label="Decrease score"
          >
            −
          </button>
          <div
            className="font-serif tabular-nums text-cream-50 transition-all"
            style={{ fontSize: "clamp(72px, 22vw, 120px)", lineHeight: 1, minWidth: 96 }}
          >
            {score ?? <span className="text-cream-100/30">·</span>}
          </div>
          <button
            className="btn bg-gold-500 text-brand-900 w-16 h-16 sm:w-20 sm:h-20 text-3xl active:scale-95 transition-transform"
            onClick={() => set((score ?? current.par) + 1)}
            aria-label="Increase score"
          >
            +
          </button>
        </div>

        <div className="mt-3 h-6">
          {out && (
            <div
              className={`font-serif tracking-[0.36em] text-base sm:text-lg uppercase transition-opacity duration-300 ${
                out.tone === "red"
                  ? "text-red-400"
                  : out.tone === "white"
                  ? "text-cream-50"
                  : out.tone === "muted"
                  ? "text-cream-100/65"
                  : "text-cream-100/45"
              }`}
            >
              {out.label}
            </div>
          )}
        </div>

      </div>

      {/* Score chip rail */}
      <div className="grid grid-cols-9 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const isCurrent = score === n;
          return (
            <button
              key={n}
              onClick={() => set(n)}
              className={`py-3 sm:py-4 rounded-xl font-serif text-xl sm:text-2xl tabular-nums transition-all active:scale-95 ${
                isCurrent
                  ? "bg-gold-500 text-brand-900 shadow-soft"
                  : "bg-brand-900/60 border border-cream-100/12 text-cream-50 hover:bg-brand-800"
              }`}
              aria-label={`Set score to ${n}`}
            >
              {n}
            </button>
          );
        })}
      </div>

      {/* Team partners' score on this hole */}
      {team && team.partners.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] mb-2">
            <span className="text-cream-100/55">{team.name}</span>
            {teamForHole != null && (
              <span className="text-gold-400">
                Team this hole: <span className="text-cream-50 tabular-nums">{teamForHole}</span>
              </span>
            )}
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-cream-50">{playerName} <span className="text-cream-100/40 text-xs">(you)</span></span>
              <span className="tabular-nums text-cream-100/70">{score ?? "—"}</span>
            </li>
            {team.partners.map((p, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-cream-50">{p.display_name}</span>
                <span className="tabular-nums text-cream-100/65">
                  {p.scores[current.hole_number] ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prev/Next */}
      <div className="flex gap-2 pb-2">
        <button
          className="btn-secondary flex-1"
          onClick={() => setHole((h) => Math.max(firstHole, h - 1))}
          disabled={hole <= firstHole}
        >
          ← Prev
        </button>
        <button
          className="btn-primary flex-1"
          onClick={() => setHole((h) => Math.min(lastHole, h + 1))}
          disabled={hole >= lastHole}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
