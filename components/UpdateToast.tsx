"use client";
import { useState } from "react";
import { useVersionWatch } from "@/lib/useVersionWatch";

/**
 * Tiny non-blocking toast that appears bottom-left when a newer deploy is
 * detected. The user picks when to refresh — we never reload them mid-round.
 * The score saver's localStorage queue already protects pending writes
 * across the refresh.
 */
export function UpdateToast() {
  const { updateAvailable } = useVersionWatch();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      className="fixed bottom-20 sm:bottom-6 left-4 z-30 max-w-xs rounded-2xl border border-cream-100/15 bg-brand-900/95 backdrop-blur shadow-soft px-4 py-3"
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mt-1.5 animate-pulse" />
        <div className="flex-1">
          <div className="text-sm font-medium text-cream-50">Update available</div>
          <p className="text-[11px] text-cream-100/65 mt-0.5 leading-snug">
            A newer version of Cruz Golf is ready. Refresh when convenient — your
            scores are saved.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => window.location.reload()}
              className="pill bg-gold-500 text-brand-900 text-xs px-3 py-1 font-medium"
            >
              Refresh
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-xs text-cream-100/55 hover:text-cream-100"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
