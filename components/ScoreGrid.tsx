"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseHole } from "@/lib/types";
import type { GroupPlayer } from "./GroupScorePad";

/**
 * Spreadsheet-style score entry. One row per player, one column per hole.
 *
 * Designed for desktop / iPad — admin/commissioner mode.
 *   - Tab/Enter moves right; Shift-Tab/Shift-Enter moves left
 *   - Up/Down arrows move between players on the same hole
 *   - Each cell saves on blur
 *   - Color-coded outcome (eagle red, birdie red, par white, bogey muted)
 *   - Running totals (gross, +/-, thru) per row
 */
export function ScoreGrid({
  holes,
  players,
  scores,
  onSave
}: {
  holes: CourseHole[];
  players: GroupPlayer[];
  scores: Record<string, number | null>;
  onSave: (roundPlayerId: string, holeNumber: number, gross: number) => void | Promise<void>;
}) {
  const ordered = useMemo(() => [...holes].sort((a, b) => a.hole_number - b.hole_number), [holes]);
  const front = ordered.slice(0, 9);
  const back = ordered.slice(9, 18);
  const k = (rpId: string, hole: number) => `${rpId}:${hole}`;

  // Cell refs for keyboard nav: cells[playerIdx][holeIdx]
  const cellsRef = useRef<Array<Array<HTMLInputElement | null>>>([]);
  function focusCell(playerIdx: number, holeIdx: number) {
    const row = cellsRef.current[playerIdx];
    if (!row) return;
    const cell = row[holeIdx];
    if (cell) {
      cell.focus();
      cell.select();
    }
  }

  function totals(p: GroupPlayer) {
    let gross = 0,
      par = 0,
      thru = 0;
    for (const h of ordered) {
      const s = scores[k(p.id, h.hole_number)];
      if (s != null) {
        gross += s;
        par += h.par;
        thru += 1;
      }
    }
    return { gross, vsPar: gross - par, thru };
  }

  function cellTone(diff: number | null): string {
    if (diff == null) return "text-cream-100/30";
    if (diff <= -2) return "text-red-300 ring-1 ring-red-400/60";
    if (diff === -1) return "text-red-200";
    if (diff === 0) return "text-cream-50";
    if (diff === 1) return "text-cream-100/65";
    return "text-cream-100/45";
  }

  function renderHoleHeader(h: CourseHole) {
    return (
      <th key={`h${h.hole_number}`} className="px-1 py-1 text-center min-w-[40px]">
        <div className="text-[10px] uppercase tracking-wider text-cream-100/50">{h.hole_number}</div>
        <div className="text-[10px] text-cream-100/40 tabular-nums">{h.par}</div>
      </th>
    );
  }

  function renderRow(p: GroupPlayer, playerIdx: number, slice: CourseHole[], offset: number) {
    cellsRef.current[playerIdx] = cellsRef.current[playerIdx] ?? [];
    return (
      <tr key={p.id} className="border-b border-cream-100/8">
        <td className="sticky left-0 bg-brand-900/95 px-2 py-1.5 z-10">
          <div className="text-sm text-cream-50 font-medium truncate max-w-[140px]">{p.display_name}</div>
          <div className="text-[10px] text-cream-100/55 tabular-nums">PH {p.playing_handicap}</div>
        </td>
        {slice.map((h, i) => {
          const idx = offset + i;
          const s = scores[k(p.id, h.hole_number)] ?? null;
          const diff = s != null ? s - h.par : null;
          const stroke = p.strokes[idx] ?? 0;
          return (
            <td key={`c${p.id}-${h.hole_number}`} className="p-0.5 text-center relative">
              {stroke > 0 && (
                <span className="absolute top-0 right-0.5 text-[8px] text-gold-400 leading-none">
                  {Array.from({ length: Math.min(stroke, 3) }, (_, i) => "•").join("")}
                </span>
              )}
              <input
                ref={(el) => {
                  cellsRef.current[playerIdx][idx] = el;
                }}
                className={`w-9 h-9 text-center text-sm tabular-nums rounded bg-brand-950/60 border border-cream-100/10 focus:border-gold-500 focus:outline-none ${cellTone(diff)}`}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                defaultValue={s ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") return;
                  const v = parseInt(raw);
                  if (isNaN(v) || v < 1 || v > 20) return;
                  if (v !== s) onSave(p.id, h.hole_number, v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.blur();
                      focusCell(playerIdx, idx + 1);
                    } else {
                      e.preventDefault();
                      e.currentTarget.blur();
                      focusCell(playerIdx, idx - 1);
                    }
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    e.currentTarget.blur();
                    focusCell(playerIdx + 1, idx);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    e.currentTarget.blur();
                    focusCell(playerIdx - 1, idx);
                  } else if (e.key === "ArrowRight" && (e.target as HTMLInputElement).selectionStart === (e.target as HTMLInputElement).value.length) {
                    e.preventDefault();
                    e.currentTarget.blur();
                    focusCell(playerIdx, idx + 1);
                  } else if (e.key === "ArrowLeft" && (e.target as HTMLInputElement).selectionStart === 0) {
                    e.preventDefault();
                    e.currentTarget.blur();
                    focusCell(playerIdx, idx - 1);
                  }
                }}
                aria-label={`${p.display_name} hole ${h.hole_number}`}
              />
            </td>
          );
        })}
        <td className="px-2 py-1.5 text-center">
          {(() => {
            const t = totals(p);
            return (
              <div>
                <div className="text-sm text-cream-50 tabular-nums">{t.gross || "—"}</div>
                <div className={`text-[10px] tabular-nums ${t.vsPar < 0 ? "text-red-300" : t.vsPar === 0 ? "text-cream-100/65" : "text-cream-100/45"}`}>
                  {t.thru === 0 ? "—" : t.vsPar === 0 ? "E" : t.vsPar > 0 ? `+${t.vsPar}` : `${t.vsPar}`}
                </div>
              </div>
            );
          })()}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 bg-brand-900/95 z-20">
            <tr>
              <th className="sticky left-0 bg-brand-900/95 px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-cream-100/55 z-30">
                Player
              </th>
              {front.map(renderHoleHeader)}
              <th className="px-1 py-1 text-center text-[10px] uppercase tracking-wider text-cream-100/55">Out</th>
            </tr>
          </thead>
          <tbody>{players.map((p, i) => renderRow(p, i, front, 0))}</tbody>
        </table>
      </div>

      {back.length > 0 && (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 bg-brand-900/95 z-20">
              <tr>
                <th className="sticky left-0 bg-brand-900/95 px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-cream-100/55 z-30">
                  Player
                </th>
                {back.map(renderHoleHeader)}
                <th className="px-1 py-1 text-center text-[10px] uppercase tracking-wider text-cream-100/55">Total</th>
              </tr>
            </thead>
            <tbody>{players.map((p, i) => renderRow(p, i, back, 9))}</tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-cream-100/50">
        Tab/Enter to move right · Shift+Tab to go back · ↑↓ between players · scores auto-save on blur
      </p>
    </div>
  );
}
