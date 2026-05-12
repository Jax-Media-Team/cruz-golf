"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { statusPillFor, type RoundStatus } from "@/components/RoundBreadcrumb";

type Round = {
  id: string;
  date: string;
  status: RoundStatus;
  courses?: { name?: string };
};

/**
 * Swipe-left or tap-⋯ exposes a single Archive action (soft-delete via
 * fn_archive_round; falls back to direct UPDATE on deleted_at if the RPC
 * is missing).
 *
 * After archive a top-of-list "Undo" banner appears for 10 seconds —
 * one-tap restore via UPDATE deleted_at = null. Replaces the prior
 * confirm() dialog so the 50-year-old golfer in sunlight isn't punished
 * for a reflexive "OK" tap. Per CLAUDE.md principle #4 — data integrity
 * over velocity, every destructive op needs a recovery path.
 */
export function RoundsList({ initialRounds }: { initialRounds: Round[] }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [rounds, setRounds] = useState(initialRounds);
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errFor, setErrFor] = useState<{ id: string; msg: string } | null>(null);
  const [undoStack, setUndoStack] = useState<{
    round: Round;
    archivedAt: number;
  } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  // Auto-clear the undo banner after 10 seconds so it doesn't linger
  // across navigation. The user can also dismiss explicitly.
  useEffect(() => {
    if (!undoStack) return;
    const elapsed = Date.now() - undoStack.archivedAt;
    const remaining = Math.max(0, 10_000 - elapsed);
    const t = setTimeout(() => setUndoStack(null), remaining);
    return () => clearTimeout(t);
  }, [undoStack]);

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

  // deleteRound REMOVED from this UI as a P0 safety measure on 2026-05-10.
  // Hard delete is admin-only via /admin/rounds going forward; the swipe
  // drawer now only offers Archive (soft, reversible).

  async function archiveRound(r: Round) {
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
    // Stash the archived round so the user can one-tap undo. We don't
    // call router.refresh() here — that would re-render the server
    // component with the round already filtered out, killing our undo
    // affordance. Refresh on undo OR on auto-clear instead.
    setUndoStack({ round: r, archivedAt: Date.now() });
  }

  async function undoArchive() {
    if (!undoStack || undoBusy) return;
    const r = undoStack.round;
    setUndoBusy(true);
    setErrFor(null);
    // Direct UPDATE — no RPC for un-archive yet. fn_archive_round 0045
    // is idempotent on archive (only stamps deleted_at when null), so
    // re-archive after undo is safe.
    const { error } = await sb
      .from("rounds")
      .update({ deleted_at: null })
      .eq("id", r.id);
    setUndoBusy(false);
    if (error) {
      setErrFor({ id: r.id, msg: friendlyAuthError(error) });
      return;
    }
    setRounds((arr) => [r, ...arr.filter((x) => x.id !== r.id)]);
    setUndoStack(null);
    router.refresh();
  }

  // Bucket by lifecycle stage so the dashboard reads as
  //   "live · awaiting · recent" instead of one undifferentiated stack.
  // Live + pending are grouped near the top because they're the rounds
  // the commissioner has work on; finalized rounds become history.
  const buckets = useMemo(() => {
    const live: Round[] = [];
    const pending: Round[] = [];
    const drafts: Round[] = [];
    const recent: Round[] = [];
    for (const r of rounds) {
      if (r.status === "live") live.push(r);
      else if (r.status === "pending_finalization") pending.push(r);
      else if (r.status === "draft") drafts.push(r);
      else recent.push(r);
    }
    return { live, pending, drafts, recent };
  }, [rounds]);

  function renderRow(r: Round) {
    const isOpen = openSwipe === r.id;
    const isBusy = busyId === r.id;
    const rowErr = errFor?.id === r.id ? errFor.msg : null;
    const pill = statusPillFor(r.status);
    return (
      <div
        key={r.id}
        className="relative overflow-hidden rounded-2xl"
        onTouchStart={onTouchStart}
        onTouchEnd={(e) => onTouchEnd(e, r.id)}
      >
        <div className="absolute inset-y-0 right-0 flex items-stretch">
          <button
            onClick={() => archiveRound(r)}
            disabled={isBusy}
            aria-label={`Archive round at ${r.courses?.name ?? "course"} on ${r.date}`}
            className="bg-cream-100/15 hover:bg-cream-100/25 text-cream-50 px-5 font-medium text-xs transition-colors"
            title="Archive — round disappears from your dashboard but stays in records and stats. Can be restored from /admin."
          >
            {isBusy ? "…" : "Archive"}
          </button>
        </div>
        <div
          className="relative bg-brand-900 transition-transform"
          style={{ transform: isOpen ? "translateX(-92px)" : "translateX(0)" }}
        >
          <div className="card card-hover p-4 flex items-center justify-between gap-3">
            <Link href={`/rounds/${r.id}`} className="flex-1 min-w-0">
              <div className="font-medium text-cream-50 truncate">
                {r.courses?.name ?? "Course"}
              </div>
              <div className="text-sm text-cream-100/55">{r.date}</div>
            </Link>
            <span className={`${pill.className} text-[10px]`}>{pill.label}</span>
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
        {rowErr && (
          <div className="card p-3 mt-1 border border-red-400/40 bg-red-500/10 text-xs text-red-200">
            {rowErr}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {undoStack && (
        <div className="card p-3 border border-cream-100/15 bg-brand-900/60 flex items-center justify-between gap-3">
          <div className="text-xs text-cream-100/85">
            Archived{" "}
            <span className="text-cream-50 font-medium">
              {undoStack.round.courses?.name ?? "round"}
            </span>{" "}
            · {undoStack.round.date}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={undoArchive}
              disabled={undoBusy}
              className="pill bg-cream-50 text-brand-900 text-xs font-medium px-3 py-1 disabled:opacity-50"
            >
              {undoBusy ? "Restoring…" : "Undo"}
            </button>
            <button
              onClick={() => setUndoStack(null)}
              className="text-cream-100/45 hover:text-cream-100 text-xs"
              aria-label="Dismiss undo banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {buckets.live.length > 0 && (
        <Bucket label="Live now" tone="emerald">
          {buckets.live.map(renderRow)}
        </Bucket>
      )}
      {buckets.pending.length > 0 && (
        <Bucket label="Awaiting finalization" tone="amber">
          {buckets.pending.map(renderRow)}
        </Bucket>
      )}
      {buckets.drafts.length > 0 && (
        <Bucket label="Drafts" tone="muted">
          {buckets.drafts.map(renderRow)}
        </Bucket>
      )}
      {buckets.recent.length > 0 && (
        <Bucket
          label={
            buckets.live.length || buckets.pending.length
              ? "Recently finalized"
              : "Finalized"
          }
          tone="muted"
        >
          {buckets.recent.map(renderRow)}
        </Bucket>
      )}
    </div>
  );
}

function Bucket({
  label,
  tone,
  children
}: {
  label: string;
  tone: "emerald" | "amber" | "muted";
  children: React.ReactNode;
}) {
  const eyebrowClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
      ? "text-amber-300"
      : "text-cream-100/55";
  return (
    <section className="space-y-2">
      <p className={`h-eyebrow ${eyebrowClass}`}>{label}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

