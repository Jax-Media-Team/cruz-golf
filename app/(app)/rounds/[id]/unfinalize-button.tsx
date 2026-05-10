"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Commissioner-only unlock for a finalized round.
 *
 * Sends round.status back to "live", clears finalized_at, and leaves
 * settlements in place so they can be re-computed at the next finalize.
 * Used to fix a wrong score that was discovered after settling up.
 */
export function UnfinalizeButton({ roundId }: { roundId: string }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock() {
    if (
      !confirm(
        "Unlock this round for edits? Players can change scores again. " +
          "You'll need to finalize again afterwards to lock the new totals."
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const { error } = await sb
      .from("rounds")
      .update({ status: "live", finalized_at: null })
      .eq("id", roundId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={busy}
        onClick={unlock}
      >
        {busy ? "Unlocking…" : "🔓 Unlock to edit"}
      </button>
      {err && <p className="text-xs text-red-300 mt-1">{err}</p>}
    </div>
  );
}
