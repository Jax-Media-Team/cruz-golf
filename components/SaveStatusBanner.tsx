"use client";
import type { SaverState } from "@/lib/useScoreSaver";

/**
 * Tiny strip that surfaces score-save state at the top of the entry pages.
 * - Hidden when nothing's pending and nothing's failed.
 * - Yellow "Saving N scores…" while in flight.
 * - Red "Couldn't save N scores" + Retry button when items have failed
 *   (after retry/backoff exhausted). Clicking Retry drains the queue again.
 */
export function SaveStatusBanner({
  state,
  onRetry
}: {
  state: SaverState;
  onRetry: () => void;
}) {
  const failedCount = Object.values(state.status).filter((s) => s === "failed").length;
  const savingCount = Object.values(state.status).filter((s) => s === "saving").length;

  if (failedCount === 0 && savingCount === 0) return null;

  if (failedCount > 0) {
    const sample = Object.entries(state.errors).find(([, v]) => v)?.[1];
    return (
      <div className="card p-3 border border-red-400/40 bg-red-500/10 flex items-center justify-between gap-3 text-sm">
        <div>
          <div className="font-medium text-red-200">
            Couldn&apos;t save {failedCount} {failedCount === 1 ? "score" : "scores"}.
          </div>
          {sample && <div className="text-[11px] text-red-200/70 mt-0.5 truncate">{sample}</div>}
        </div>
        <button
          onClick={onRetry}
          className="pill bg-red-200 text-red-900 text-xs font-medium px-3 py-1.5"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="card p-2.5 border border-gold-500/30 bg-gold-500/5 flex items-center gap-2 text-xs">
      <span className="inline-block w-2 h-2 rounded-full bg-gold-500 animate-pulse" />
      <span className="text-cream-100/85">
        Saving {savingCount} {savingCount === 1 ? "score" : "scores"}…
      </span>
    </div>
  );
}
