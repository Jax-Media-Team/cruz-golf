"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Archive / restore button for an event. Commissioner-only.
 *
 * Calls fn_archive_event / fn_restore_event RPCs from migration 0040,
 * which write destructive_audit_log entries. Archive is soft — the
 * event row stays in place with deleted_at set, so historical data
 * (records, clubhouse signals) keeps it.
 */
export function EventArchiveButton({
  eventId,
  eventName,
  isArchived
}: {
  eventId: string;
  eventName: string;
  isArchived: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act() {
    if (isArchived) {
      if (!confirm(`Restore "${eventName}"?`)) return;
    } else {
      if (
        !confirm(
          `Archive "${eventName}"? Foursomes inside the event stay intact; the event disappears from active browsing but stays in audit + history.`
        )
      )
        return;
    }
    setBusy(true);
    setErr(null);
    const rpc = isArchived ? "fn_restore_event" : "fn_archive_event";
    const { error } = await sb.rpc(rpc, { p_event_id: eventId });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={act}
        disabled={busy}
        className={
          isArchived
            ? "btn-ghost text-xs"
            : "btn-ghost text-xs text-red-300"
        }
        title={isArchived ? "Restore event" : "Archive event"}
      >
        {busy ? "…" : isArchived ? "Restore" : "Archive"}
      </button>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </div>
  );
}
