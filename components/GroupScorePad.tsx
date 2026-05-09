"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseHole } from "@/lib/types";

export type GroupPlayer = {
  /** round_player_id — the row we save scores against */
  id: string;
  display_name: string;
  playing_handicap: number;
  /** Strokes received per hole, in hole-order (index 0 = first hole). */
  strokes: number[];
};

type Props = {
  holes: CourseHole[];
  players: GroupPlayer[];
  /** scores keyed by `${round_player_id}:${hole_number}` → gross. */
  scores: Record<string, number | null>;
  initialHole?: number;
  onSave: (roundPlayerId: string, holeNumber: number, gross: number) => void | Promise<void>;
};

function outcomeLabel(diff: number): { label: string; tone: "red" | "white" | "muted" } {
  if (diff <= -2) return { label: diff <= -3 ? "ALB" : "EAGLE", tone: "red" };
  if (diff === -1) return { label: "BIRDIE", tone: "red" };
  if (diff === 0) return { label: "PAR", tone: "white" };
  if (diff === 1) return { label: "BOGEY", tone: "muted" };
  return { label: `+${diff}`, tone: "muted" };
}

const k = (rpId: string, hole: number) => `${rpId}:${hole}`;

export function GroupScorePad({ holes, players, scores, initialHole, onSave }: Props) {
  const ordered = useMemo(() => [...holes].sort((a, b) => a.hole_number - b.hole_number), [holes]);
  const firstHole = ordered[0]?.hole_number ?? 1;
  const lastHole = ordered[ordered.length - 1]?.hole_number ?? 18;

  // First hole where any selected player still has no score.
  const firstEmpty = (() => {
    for (const h of ordered) {
      if (players.some((p) => scores[k(p.id, h.hole_number)] == null)) return h.hole_number;
    }
    return firstHole;
  })();

  const [hole, setHole] = useState(initialHole ?? firstEmpty);
  const [openChips, setOpenChips] = useState<string | null>(null); // round_player_id of expanded row

  const current = ordered.find((h) => h.hole_number === hole) ?? ordered[0];
  const idx = ordered.findIndex((h) => h.hole_number === current.hole_number);

  // Touch swipe between holes (top hole strip / context only)
  const startX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current == null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && hole < lastHole) setHole(hole + 1);
    if (dx > 0 && hole > firstHole) setHole(hole - 1);
  }

  // Auto-advance: when every player has a score on the current hole, move forward (once).
  const allEntered = players.length > 0 && players.every((p) => scores[k(p.id, current.hole_number)] != null);
  const advanceArmed = useRef(false);
  useEffect(() => {
    if (!allEntered) {
      advanceArmed.current = true;
      return;
    }
    if (!advanceArmed.current) return;
    advanceArmed.current = false;
    if (current.hole_number < lastHole) {
      const t = setTimeout(() => setHole((h) => Math.min(lastHole, h + 1)), 600);
      return () => clearTimeout(t);
    }
  }, [allEntered, current.hole_number, lastHole]);

  return (
    <div className="space-y-4 select-none">
      {/* Hole context */}
      <div
        className="card p-4 flex items-center justify-between gap-3"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          className="btn bg-brand-900/70 border border-cream-100/15 text-cream-50 w-10 h-10 text-xl active:scale-95 disabled:opacity-30"
          onClick={() => setHole(Math.max(firstHole, hole - 1))}
          disabled={hole <= firstHole}
          aria-label="Previous hole"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400">Hole {current.hole_number}</div>
          <div className="font-serif text-3xl text-cream-50 leading-tight tabular-nums">Par {current.par}</div>
          <div className="text-xs text-cream-100/55 mt-0.5">SI {current.stroke_index}</div>
        </div>
        <button
          className="btn bg-gold-500 text-brand-900 w-10 h-10 text-xl active:scale-95 disabled:opacity-30"
          onClick={() => setHole(Math.min(lastHole, hole + 1))}
          disabled={hole >= lastHole}
          aria-label="Next hole"
        >
          →
        </button>
      </div>

      {/* Hole nav strip */}
      <div className="overflow-x-auto -mx-4 px-4 pb-1">
        <div className="flex gap-1.5 min-w-max">
          {ordered.map((h) => {
            const filled = players.every((p) => scores[k(p.id, h.hole_number)] != null) && players.length > 0;
            const partial = !filled && players.some((p) => scores[k(p.id, h.hole_number)] != null);
            const active = h.hole_number === current.hole_number;
            return (
              <button
                key={h.hole_number}
                onClick={() => setHole(h.hole_number)}
                className={`px-2 py-1.5 min-w-[40px] rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-gold-500 text-brand-900 shadow-soft"
                    : filled
                    ? "bg-brand-700/70 text-cream-50"
                    : partial
                    ? "bg-brand-800/70 text-cream-50 border border-gold-500/30"
                    : "bg-brand-900/60 border border-cream-100/12 text-cream-100/65"
                }`}
                aria-label={`Go to hole ${h.hole_number}`}
              >
                <span className="font-medium tabular-nums">{h.hole_number}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Player rows */}
      <div className="space-y-2">
        {players.map((p) => {
          const s = scores[k(p.id, current.hole_number)] ?? null;
          const st = p.strokes[idx] ?? 0;
          const out = s != null ? outcomeLabel(s - current.par) : null;
          const expanded = openChips === p.id;
          return (
            <div
              key={p.id}
              className={`card p-3 transition-colors ${expanded ? "ring-1 ring-gold-500/40" : ""}`}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setOpenChips(expanded ? null : p.id)}
                  className="flex-1 min-w-0 text-left"
                  aria-label={`Show number pad for ${p.display_name}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-lg text-cream-50 truncate">{p.display_name}</span>
                    {st > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-gold-400 text-[10px]">
                        {Array.from({ length: Math.min(st, 3) }, (_, i) => (
                          <span key={i} className="w-1.5 h-1.5 rounded-full bg-gold-500" />
                        ))}
                        <span className="ml-0.5">+{st}</span>
                      </span>
                    )}
                  </div>
                  {out && (
                    <div
                      className={`text-[10px] uppercase tracking-[0.28em] mt-0.5 ${
                        out.tone === "red"
                          ? "text-red-400"
                          : out.tone === "white"
                          ? "text-cream-50"
                          : "text-cream-100/55"
                      }`}
                    >
                      {out.label}
                    </div>
                  )}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="btn bg-brand-900/70 border border-cream-100/15 text-cream-50 w-11 h-11 text-2xl active:scale-95"
                    onClick={() => onSave(p.id, current.hole_number, Math.max(1, (s ?? current.par + st) - 1))}
                    aria-label={`Decrease ${p.display_name} score`}
                  >
                    −
                  </button>
                  <div
                    className="font-serif tabular-nums text-cream-50 text-center"
                    style={{ fontSize: 36, lineHeight: 1, width: 56 }}
                  >
                    {s ?? <span className="text-cream-100/30">·</span>}
                  </div>
                  <button
                    className="btn bg-gold-500 text-brand-900 w-11 h-11 text-2xl active:scale-95"
                    onClick={() => onSave(p.id, current.hole_number, (s ?? current.par + st - 1) + 1)}
                    aria-label={`Increase ${p.display_name} score`}
                  >
                    +
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="grid grid-cols-9 gap-1.5 mt-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        onSave(p.id, current.hole_number, n);
                        setOpenChips(null);
                      }}
                      className={`py-2.5 rounded-lg font-serif text-lg tabular-nums transition-all active:scale-95 ${
                        s === n
                          ? "bg-gold-500 text-brand-900 shadow-soft"
                          : "bg-brand-900/60 border border-cream-100/12 text-cream-50"
                      }`}
                      aria-label={`Set ${p.display_name} to ${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer nav */}
      <div className="flex gap-2 pb-2">
        <button
          className="btn-secondary flex-1"
          onClick={() => setHole(Math.max(firstHole, hole - 1))}
          disabled={hole <= firstHole}
        >
          ← Prev
        </button>
        <button
          className="btn-primary flex-1"
          onClick={() => setHole(Math.min(lastHole, hole + 1))}
          disabled={hole >= lastHole}
        >
          {allEntered ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}
