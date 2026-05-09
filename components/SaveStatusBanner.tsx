"use client";
import { useState } from "react";
import type { SaverState } from "@/lib/useScoreSaver";

type Diagnosis = {
  ok: boolean;
  reason: string;
  explain: string;
  facts?: Record<string, unknown>;
};

/**
 * Strip surfacing score-save state at the top of entry pages.
 * - Hidden when nothing's pending and nothing's failed.
 * - Yellow "Saving N…" while in flight.
 * - Red banner on failure with the actual error text and four escapes:
 *     Retry    — drain the queue again
 *     Diagnose — for RLS errors, hits /api/diagnose/round-access for a
 *                plain-English reason (commissioner role missing,
 *                wagers not acked, etc.)
 *     Details  — full per-item error list
 *     Discard  — clear stuck items
 */
export function SaveStatusBanner({
  state,
  onRetry,
  onDiscard,
  roundId
}: {
  state: SaverState;
  onRetry: () => void;
  onDiscard?: () => void;
  roundId?: string;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  async function diagnose() {
    if (!roundId) return;
    setDiagBusy(true);
    try {
      const res = await fetch(`/api/diagnose/round-access?round_id=${encodeURIComponent(roundId)}`, {
        cache: "no-store"
      });
      const json = (await res.json()) as Diagnosis;
      setDiag(json);
    } catch (e: any) {
      setDiag({ ok: false, reason: "fetch_failed", explain: e?.message ?? "Network error" });
    } finally {
      setDiagBusy(false);
    }
  }
  const failedCount = Object.values(state.status).filter((s) => s === "failed").length;
  const savingCount = Object.values(state.status).filter((s) => s === "saving").length;

  if (failedCount === 0 && savingCount === 0) return null;

  if (failedCount > 0) {
    const errorEntries = Object.entries(state.errors).filter(([, v]) => v);
    const sample = errorEntries[0]?.[1];
    const isRls = sample?.toLowerCase().includes("row-level security") ?? false;
    return (
      <div className="card p-3 border border-red-400/40 bg-red-500/10 space-y-2 text-sm sticky top-2 z-20 shadow-soft">
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
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <button
              onClick={onRetry}
              className="pill bg-red-200 text-red-900 text-xs font-medium px-3 py-1.5"
            >
              Retry
            </button>
            {isRls && roundId && (
              <button
                onClick={diagnose}
                disabled={diagBusy}
                className="pill bg-amber-200 text-amber-900 text-xs font-medium px-3 py-1.5"
              >
                {diagBusy ? "Checking…" : "Diagnose"}
              </button>
            )}
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
        {diag && (
          <div
            className={`rounded-lg p-2.5 text-[12px] leading-snug ${
              diag.ok
                ? "bg-emerald-500/15 text-emerald-100 border border-emerald-400/30"
                : "bg-amber-500/15 text-amber-100 border border-amber-400/30"
            }`}
          >
            <div className="font-medium uppercase tracking-wide text-[10px] mb-1">
              Diagnosis · {diag.reason}
            </div>
            <div>{diag.explain}</div>
          </div>
        )}
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

  // Compact "saving" pill that floats top-right and never reflows the page.
  // Each tap was rendering this in normal flow and pushing content down for
  // ~150ms then back up — felt like the page was jumping mid-tap.
  return (
    <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-30 px-2.5 py-1 rounded-full border border-gold-500/30 bg-gold-500/15 backdrop-blur flex items-center gap-2 text-[11px] shadow-soft">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />
      <span className="text-cream-100">
        Saving{savingCount > 1 ? ` ${savingCount}` : ""}…
      </span>
    </div>
  );
}
