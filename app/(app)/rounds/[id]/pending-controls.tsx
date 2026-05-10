"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Commissioner controls for the pending_finalization lifecycle.
 *
 *  - "Move to Awaiting Finalization" — used by a commissioner when the
 *    round is done playing but they're not ready to lock settlements.
 *    The round drops out of the dashboard's "Live now" bucket but
 *    stays fully editable; players can still add missing scores or
 *    OCR-import a card later. Settlements are NOT written.
 *
 *  - "Resume scoring" — moves the round from pending back to live.
 *    Used when something needs fixing (missing score, late OCR
 *    upload, wager dispute) before finalization.
 *
 * NOT impersonation, NOT a destructive op. The transition is a single
 * column update and is fully reversible. fn_mark_round_pending and
 * fn_resume_round both gate on commissioner role.
 */
export function MarkPendingButton({
  roundId,
  variant = "card"
}: {
  roundId: string;
  /** "card" = full-width card style; "inline" = small button. */
  variant?: "card" | "inline";
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_mark_round_pending", {
      p_round_id: roundId
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  if (variant === "inline") {
    return (
      <>
        <button
          type="button"
          onClick={mark}
          disabled={busy}
          className="btn-ghost text-xs"
          title="Drop this round out of the live bucket without locking settlements"
        >
          {busy ? "Moving…" : "Move to awaiting finalization"}
        </button>
        {err && <span className="text-xs text-red-300 ml-2">{err}</span>}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={mark}
      disabled={busy}
      className="card card-hover p-3 text-left w-full sm:w-auto inline-flex items-center justify-between gap-3 border border-amber-400/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
      title="Drop this round out of the live bucket without locking settlements"
    >
      <div>
        <div className="font-serif text-sm text-cream-50">
          Move to awaiting finalization
        </div>
        <p className="text-[11px] text-cream-100/65 mt-0.5">
          Drops out of the live bucket. Still fully editable. No settlements
          written until you finalize.
        </p>
      </div>
      <span className="text-xs text-cream-100/55 shrink-0">
        {busy ? "Moving…" : "Move →"}
      </span>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </button>
  );
}

export function ResumeRoundButton({ roundId }: { roundId: string }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_resume_round", {
      p_round_id: roundId
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        className="btn-secondary text-xs"
      >
        {busy ? "Resuming…" : "↩ Resume scoring"}
      </button>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}
