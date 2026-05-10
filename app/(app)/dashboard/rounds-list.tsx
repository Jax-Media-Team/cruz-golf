"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

type Round = {
  id: string;
  date: string;
  status: "draft" | "live" | "finalized";
  courses?: { name?: string };
};

/**
 * Swipe-left or tap-⋯ to open the row's actions: Archive (always works,
 * soft-delete) or Delete (hard delete via fn_delete_round RPC). If hard
 * delete fails, we offer "Archive instead" without making the user re-enter
 * the swipe.
 */
export function RoundsList({ initialRounds }: { initialRounds: Round[] }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [rounds, setRounds] = useState(initialRounds);
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errFor, setErrFor] = useState<{ id: string; msg: string } | null>(null);

  const startX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent, id: string) {
    if (startX.current == null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    startX.current = null;
    if (dx < -60) setOpenSwipe(id);
    else if (dx > 30) setOpenSwipe(null);
  }

  async function deleteRound(r: Round) {
    if (
      !confirm(
        `Permanently delete this ${r.status} round at ${r.courses?.name ?? "the course"} on ${r.date}? Removes scores, games, and settlements. Cannot be undone.`
      )
    )
      return;
    setBusyId(r.id);
    setErrFor(null);
    const { error } = await sb.rpc("fn_delete_round", { p_round_id: r.id });
    setBusyId(null);
    if (error) {
      // Show actionable error with an immediate "Archive instead" option.
      // friendlyAuthError translates known error patterns; we also include
      // the raw message so we can debug stuck rows.
      const friendly = friendlyAuthError(error);
      const raw = (error as any)?.message ?? "";
      setErrFor({
        id: r.id,
        msg: `${friendly}${raw && !friendly.includes(raw) ? ` (${raw})` : ""}`
      });
      return;
    }
    setRounds((arr) => arr.filter((x) => x.id !== r.id));
    setOpenSwipe(null);
    router.refresh();
  }

  async function archiveRound(r: Round) {
    if (
      !confirm(
        `Archive this round? It'll disappear from your dashboard but stay in records and stats. You can restore it from Admin if needed.`
      )
    )
      return;
    setBusyId(r.id);
    setErrFor(null);
    const { error } = await sb.rpc("fn_archive_round", { p_round_id: r.id });
    setBusyId(null);
    if (error) {
      // Fallback: try a direct UPDATE if the RPC isn't installed yet.
      const { error: e2 } = await sb
        .from("rounds")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", r.id);
      if (e2) {
        setErrFor({ id: r.id, msg: friendlyAuthError(e2) });
        return;
      }
    }
    setRounds((arr) => arr.filter((x) => x.id !== r.id));
    setOpenSwipe(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {rounds.map((r) => {
        const isOpen = openSwipe === r.id;
        const isBusy = busyId === r.id;
        const rowErr = errFor?.id === r.id ? errFor.msg : null;
        return (
          <div
            key={r.id}
            className="relative overflow-hidden rounded-2xl"
            onTouchStart={onTouchStart}
            onTouchEnd={(e) => onTouchEnd(e, r.id)}
          >
            {/* Action drawer behind the card — Archive + Delete */}
            <div className="absolute inset-y-0 right-0 flex items-stretch">
              <button
                onClick={() => archiveRound(r)}
                disabled={isBusy}
                aria-label={`Archive round at ${r.courses?.name ?? "course"} on ${r.date}`}
                className="bg-cream-100/15 hover:bg-cream-100/25 text-cream-50 px-4 font-medium text-xs transition-colors"
              >
                {isBusy ? "…" : "Archive"}
              </button>
              <button
                onClick={() => deleteRound(r)}
                disabled={isBusy}
                aria-label={`Delete round at ${r.courses?.name ?? "course"} on ${r.date}`}
                className="bg-red-600 hover:bg-red-700 text-cream-50 px-4 font-medium text-xs transition-colors"
              >
                {isBusy ? "…" : "Delete"}
              </button>
            </div>

            {/* Foreground card slides left when swiped open */}
            <div
              className="relative bg-brand-900 transition-transform"
              style={{ transform: isOpen ? "translateX(-160px)" : "translateX(0)" }}
            >
              <div className="card card-hover p-4 flex items-center justify-between gap-3">
                <Link href={`/rounds/${r.id}`} className="flex-1 min-w-0">
                  <div className="font-medium text-cream-50 truncate">
                    {r.courses?.name ?? "Course"}
                  </div>
                  <div className="text-sm text-cream-100/55">{r.date}</div>
                </Link>
                <span
                  className={
                    r.status === "live"
                      ? "pill-live"
                      : r.status === "finalized"
                      ? "pill-final"
                      : "pill-draft"
                  }
                >
                  {r.status}
                </span>
                <button
                  onClick={() => setOpenSwipe(isOpen ? null : r.id)}
                  aria-label="Toggle row actions"
                  className="text-cream-100/40 hover:text-red-300 text-lg leading-none px-1"
                  title={isOpen ? "Hide actions" : "Show actions"}
                >
                  {isOpen ? "←" : "⋯"}
                </button>
              </div>
            </div>

            {/* Per-row error with a one-tap Archive fallback */}
            {rowErr && (
              <div className="card p-3 mt-1 border border-red-400/40 bg-red-500/10 text-xs text-red-200 flex items-center justify-between gap-3">
                <span className="flex-1">{rowErr}</span>
                <button
                  type="button"
                  onClick={() => archiveRound(r)}
                  className="btn-secondary text-xs whitespace-nowrap"
                >
                  Archive instead →
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
