"use client";
import { useState } from "react";
import type { SaverState } from "@/lib/useScoreSaver";

/**
 * Strip surfacing score-save state at the top of entry pages.
 * - Hidden when nothing's pending and nothing's failed.
 * - Yellow "Saving N…" while in flight.
 * - Red banner on failure with the actual error text and three escapes:
 *     Retry  — drain the queue again
 *     Details — show the full per-item error list (good for diagnosing RLS)
 *     Discard — clear stuck items (e.g. queue items targeting a deleted round)
 */
export function SaveStatusBanner({
  state,
  onRetry,
  onDiscard
}: {
  state: SaverState;
  onRetry: () => void;
  onDiscard?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const failedCount = Object.values(state.status).filter((s) => s === "failed").length;
  const savingCount = Object.values(state.status).filter((s) => s === "saving").length;

  if (failedCount === 0 && savingCount === 0) return null;

  if (failedCount > 0) {
    const errorEntries = Object.entries(state.errors).filter(([, v]) => v);
    const sample = errorEntries[0]?.[1];
    const isRls = sample?.toLowerCase().includes("row-level security") ?? false;
    return (
      <div className="card p-3 border border-red-400/40 bg-red-500/10 space-y-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-red-200">
              Couldn&apos;t save {failedCount} {failedCount === 1 ? "score" : "scores"}.
            </div>
            {sample && (
              <div className="text-[12px] text-red-200/85 mt-0.5 break-words">
                {sample}
              </div>
            )}
            {isRls && (
              <p className="text-[11px] text-red-100/70 mt-1 leading-snug">
                The database refused the write. Most often this means the queue
                still has scores from an old or deleted round. Tap{" "}
                <span className="font-medium">Discard</span> to clear them.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onRetry}
              className="pill bg-red-200 text-red-900 text-xs font-medium px-3 py-1.5"
            >
              Retry
            </button>
            {onDiscard && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Discard ${failedCount} stuck score(s)? They won't be sent to the server. Future scores you enter will save normally.`
                    )
                  ) {
                    onDiscard();
                  }
                }}
                className="pill bg-brand-900/60 border border-cream-100/15 text-cream-100/85 text-xs px-3 py-1.5"
              >
                Discard
              </button>
            )}
          </div>
        </div>
        {errorEntries.length > 1 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="text-[11px] text-red-100/70 hover:text-red-100 underline"
            >
              {showDetails ? "Hide" : `Show all ${errorEntries.length}`} error
              {errorEntries.length === 1 ? "" : "s"}
            </button>
            {showDetails && (
              <ul className="mt-1.5 space-y-1 text-[11px] text-red-200/85">
                {errorEntries.map(([key, msg]) => (
                  <li key={key} className="font-mono break-all">
                    <span className="text-red-100/60">{key}</span> — {msg}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
