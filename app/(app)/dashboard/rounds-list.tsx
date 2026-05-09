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
 * Swipe-left or tap-X to delete. Confirms before issuing the delete.
 *
 * RLS on rounds requires commissioner role to delete; the schema's cascade
 * deletes clear round_players, scores, round_games, settlements, etc.
 */
export function RoundsList({ initialRounds }: { initialRounds: Round[] }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [rounds, setRounds] = useState(initialRounds);
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        `Delete this ${r.status} round at ${r.courses?.name ?? "the course"} on ${r.date}? This permanently removes scores, games, and settlements. Cannot be undone.`
      )
    )
      return;
    setBusyId(r.id);
    setErr(null);
    const { error } = await sb.from("rounds").delete().eq("id", r.id);
    setBusyId(null);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setRounds((arr) => arr.filter((x) => x.id !== r.id));
    setOpenSwipe(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {err && (
        <div className="card p-3 border border-red-400/40 bg-red-500/10 text-sm text-red-200">
          {err}
        </div>
      )}
      {rounds.map((r) => {
        const isOpen = openSwipe === r.id;
        const isBusy = busyId === r.id;
        return (
          <div
            key={r.id}
            className="relative overflow-hidden rounded-2xl"
            onTouchStart={onTouchStart}
            onTouchEnd={(e) => onTouchEnd(e, r.id)}
          >
            {/* Delete drawer behind the card */}
            <div className="absolute inset-y-0 right-0 flex items-stretch">
              <button
                onClick={() => deleteRound(r)}
                disabled={isBusy}
                aria-label={`Delete round at ${r.courses?.name ?? "course"} on ${r.date}`}
                className="bg-red-600 hover:bg-red-700 text-cream-50 px-5 font-medium text-sm transition-colors"
              >
                {isBusy ? "Deleting…" : "Delete"}
              </button>
            </div>

            {/* Foreground card slides left when swiped open */}
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
                {/* Desktop / explicit delete affordance — small × that opens the swipe drawer */}
                <button
                  onClick={() => setOpenSwipe(isOpen ? null : r.id)}
                  aria-label="Toggle delete option"
                  className="text-cream-100/40 hover:text-red-300 text-lg leading-none px-1"
                  title={isOpen ? "Hide delete" : "Show delete"}
                >
                  {isOpen ? "←" : "⋯"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
