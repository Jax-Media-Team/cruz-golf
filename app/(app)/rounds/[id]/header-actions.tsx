"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ShareSheet } from "@/components/ShareSheet";

type Props = {
  roundId: string;
  spectatorToken: string;
  pin: string | null;
  accessMode: "invited" | "open_to_group";
  isCommissioner: boolean;
  /** True when the round has been soft-deleted (deleted_at is not null).
   *  Controls whether the commissioner sees Archive vs Restore. */
  isArchived?: boolean;
  /** Status — used by the delete-safety warning so we can hint
   *  "this round has scores" before the user permanently destroys it. */
  status?: "draft" | "live" | "pending_finalization" | "finalized";
  /** True when the round has ANY non-trivial data attached — scores,
   *  junk items, or accepted/pending manual presses. Surfaces in the
   *  delete dialog: deleting a round with real data is a much
   *  bigger action than deleting an empty draft. Includes junk +
   *  presses (2026-05-12 fix; previously was scores-only). */
  hasRealData?: boolean;
};

/**
 * Round header actions — split into two clear bands:
 *
 *  1. "Who can play?" band (commissioners only)
 *     Shows the active access mode + a one-click toggle, AND tailors the
 *     invite affordances to that mode:
 *       - "Invited only": surface the PIN + a Copy-invite button. Players
 *         join with the PIN.
 *       - "Open to group": no PIN needed. Surface a "Copy join link" so
 *         any group member can hop in.
 *
 *  2. Spectator share band — works in both modes; anyone with the link
 *     can watch the live leaderboard read-only.
 *
 * Plus the commissioner's "round-prep" quick actions (Upload card photo).
 *
 * NOTE: Invites and Finalize used to live here too. They were moved to the
 * round page's secondary-actions grid so each round-state action has
 * exactly one entry point. Header is now strictly round-meta + share +
 * pre-round prep.
 */
export function RoundHeaderActions({
  roundId,
  spectatorToken,
  pin,
  accessMode,
  isCommissioner,
  isArchived = false,
  status,
  hasRealData = false
}: Props) {
  const [showPin, setShowPin] = useState(false);
  const [mode, setMode] = useState(accessMode);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const sb = supabaseBrowser();
  const router = useRouter();

  // Soft-delete the round via fn_archive_round (migration 0021). Hides
  // from active lists. Restorable.
  async function archive() {
    if (!confirm("Archive this round? It hides from active lists but everything is preserved — you can restore it any time.")) {
      return;
    }
    setBusy(true);
    setActionErr(null);
    const { error } = await sb.rpc("fn_archive_round", { p_round_id: roundId });
    setBusy(false);
    if (error) {
      setActionErr(error.message);
      return;
    }
    router.push("/dashboard");
  }

  // Reverse archive — back to active state. Unlike archive/delete
  // we stay on the round page (no navigation), so surface a brief
  // success message so the user knows the action took.
  async function restore() {
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    const { error } = await sb.rpc("fn_restore_round", { p_round_id: roundId });
    setBusy(false);
    if (error) {
      setActionErr(error.message);
      return;
    }
    setActionMsg("Round restored. Refreshing…");
    router.refresh();
    // Clear the message a bit later — by then router.refresh has
    // re-rendered the parent server component and the "This round
    // is archived" block has flipped to the active-round actions.
    setTimeout(() => setActionMsg(null), 3000);
  }

  // Hard delete via fn_delete_round. Cascades through scores,
  // presses, junk, settlements, etc. (see migration 0044). Distinct
  // from archive: gone forever, no recovery.
  //
  // Two-step confirm when the round has real data attached. The
  // second prompt uses window.prompt() so the user must literally
  // type a word — confirm() alone is too easy to muscle-memory.
  async function hardDelete() {
    const scoreWarn = hasRealData
      ? "This round HAS REAL DATA attached (scores, junk, presses, or settlements). Deleting will erase ALL of it. "
      : "";
    const proceed = confirm(
      `Permanently DELETE this round? ${scoreWarn}This cannot be undone — the round and everything attached to it are gone forever.\n\nFor most cleanup needs, "Archive" is the right choice instead — it hides the round but keeps everything restorable.`
    );
    if (!proceed) return;
    // Real second-step gate: the user has to type the word "delete"
    // into the prompt. Cancel + empty + wrong word all back out.
    // confirm() doesn't validate input; prompt() does.
    if (hasRealData) {
      const typed = window.prompt(
        `Last check.\n\nThis erases real scoring data forever. Type "delete" (lowercase, no quotes) to confirm.`
      );
      if (typed !== "delete") {
        setActionErr(
          typed == null
            ? null
            : `Didn't see "delete" — round NOT deleted. Try again if you really meant it.`
        );
        return;
      }
    }
    setBusy(true);
    setActionErr(null);
    const { error } = await sb.rpc("fn_delete_round", { p_round_id: roundId });
    setBusy(false);
    if (error) {
      setActionErr(error.message);
      return;
    }
    router.push("/dashboard");
  }

  function copy(text: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    }
  }

  async function setAccessMode(next: "invited" | "open_to_group") {
    setBusy(true);
    const { error } = await sb.from("rounds").update({ access_mode: next }).eq("id", roundId);
    setBusy(false);
    if (!error) setMode(next);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const spectatorUrl = `${origin}/rounds/${roundId}/leaderboard?token=${spectatorToken}`;
  const joinUrl = `${origin}/rounds/${roundId}/join`;

  return (
    <div className="space-y-2">
      {/* Commissioner: who can play? */}
      {isCommissioner && (
        <div className="card p-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="h-eyebrow text-gold-400">Who can play</p>
              <p className="text-cream-50 mt-1 font-medium">
                {mode === "open_to_group" ? "Open to your group" : "Invite-only (PIN)"}
              </p>
              <p className="text-[11px] text-cream-100/55 mt-0.5">
                {mode === "open_to_group"
                  ? "Anyone in your group can open the round and enter scores. No PIN."
                  : "Players need the PIN below (or a direct invite) to join. Spectators can still watch with the share link."}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={busy || mode === "invited"}
                onClick={() => setAccessMode("invited")}
                className={`pill text-xs px-3 py-1.5 ${
                  mode === "invited"
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
                }`}
              >
                PIN
              </button>
              <button
                type="button"
                disabled={busy || mode === "open_to_group"}
                onClick={() => setAccessMode("open_to_group")}
                className={`pill text-xs px-3 py-1.5 ${
                  mode === "open_to_group"
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
                }`}
              >
                Open
              </button>
            </div>
          </div>

          {mode === "invited" && pin && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={() => setShowPin((v) => !v)}
                className="surface rounded-lg px-3 py-2 inline-flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
                aria-label="Toggle round PIN"
              >
                <span className="h-eyebrow">PIN</span>
                <span className="font-serif text-2xl tracking-[0.3em] text-cream-50 tabular-nums">
                  {showPin ? pin : "••••"}
                </span>
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={() =>
                  copy(`Cruz Golf round\nPIN: ${pin}\n${joinUrl}`, "Invite + PIN")
                }
              >
                {copied === "Invite + PIN" ? "Copied!" : "Copy invite + PIN"}
              </button>
            </div>
          )}

          {mode === "open_to_group" && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-cream-100/55">
                Group members go to the round directly — no PIN needed.
              </p>
              <button
                className="btn-secondary text-xs"
                onClick={() => copy(joinUrl, "Round link")}
              >
                {copied === "Round link" ? "Copied!" : "Copy round link"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Everyone: spectator + commissioner quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <ShareSheet
          title="Live leaderboard"
          url={spectatorUrl}
          imageUrl={`/api/share/round/${roundId}/image?token=${spectatorToken}`}
          imageFilename={`cruz-golf-${roundId}.png`}
          triggerLabel="Share"
          triggerClassName="btn-secondary text-xs"
        />
        {isCommissioner && (
          <Link href={`/rounds/${roundId}/upload`} className="btn-secondary text-xs">
            Upload card photo
          </Link>
        )}
      </div>

      {/* Commissioner: archive / restore / delete. Surfaced on the
          round page itself so the destructive actions are findable,
          per Patrick's "make the trash option obvious" ask. The
          distinction between archive (safe, recoverable) and delete
          (permanent) is loud: separate buttons, distinct phrasing,
          two-step confirm on delete-with-scores. */}
      {isCommissioner && (
        <details className="card p-3 group">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.22em] text-cream-100/55 select-none flex items-center justify-between gap-2">
            <span>Round settings · archive or delete</span>
            <span className="text-cream-100/45 group-open:hidden">▸</span>
            <span className="text-cream-100/45 hidden group-open:inline">▾</span>
          </summary>
          <div className="mt-3 space-y-3 text-sm">
            {isArchived ? (
              <>
                <div>
                  <p className="font-medium text-cream-50">
                    This round is archived
                  </p>
                  <p className="text-[11px] text-cream-100/55 mt-0.5 leading-snug">
                    Hidden from active lists. Scores, presses, junk, and
                    settlements are all preserved. Restoring brings it
                    back to wherever it was in its lifecycle.
                  </p>
                  <button
                    type="button"
                    className="btn-primary text-xs mt-2"
                    disabled={busy}
                    onClick={restore}
                  >
                    Restore round
                  </button>
                </div>
                <div className="border-t border-red-400/20 pt-3">
                  <p className="font-medium text-red-200">Danger zone</p>
                  <p className="text-[11px] text-cream-100/55 mt-0.5 leading-snug">
                    Permanently deletes this round and{" "}
                    <span className="font-medium">everything</span>{" "}
                    attached — scores, presses, junk, settlements. Cannot
                    be undone.
                  </p>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-red-300 mt-2"
                    disabled={busy}
                    onClick={hardDelete}
                  >
                    Delete permanently
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="font-medium text-cream-50">Archive round</p>
                  <p className="text-[11px] text-cream-100/55 mt-0.5 leading-snug">
                    Hides this round from active lists + the dashboard.{" "}
                    <span className="text-emerald-300">Reversible</span>{" "}
                    — restore any time from the dashboard&apos;s{" "}
                    &ldquo;Archived rounds&rdquo; section.
                  </p>
                  <p className="text-[11px] text-cream-100/55 mt-1 leading-snug">
                    <span className="text-cream-100/85">Important:</span>{" "}
                    finalized archived rounds <em>still</em> count in
                    your group&apos;s records, leaderboards, and stats —
                    they really happened. If you want a test round to
                    not count, <span className="font-medium">Delete</span>{" "}
                    it instead.
                  </p>
                  <button
                    type="button"
                    className="btn-secondary text-xs mt-2"
                    disabled={busy}
                    onClick={archive}
                  >
                    Archive this round
                  </button>
                </div>
                <div className="border-t border-red-400/20 pt-3">
                  <p className="font-medium text-red-200">
                    Delete round permanently
                  </p>
                  <p className="text-[11px] text-cream-100/55 mt-0.5 leading-snug">
                    Erases the round and{" "}
                    <span className="font-medium">everything</span>{" "}
                    attached — scores, presses, junk, settlements.{" "}
                    <span className="text-red-300">Cannot be undone.</span>
                    {hasRealData && (
                      <>
                        {" "}This round has scores; you&apos;ll be asked to
                        confirm twice.
                      </>
                    )}{" "}
                    For most cleanup needs, Archive is the right choice.
                  </p>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-red-300 mt-2"
                    disabled={busy}
                    onClick={hardDelete}
                  >
                    Delete this round
                  </button>
                </div>
              </>
            )}
            {actionMsg && (
              <p className="text-[11px] text-emerald-300">{actionMsg}</p>
            )}
            {actionErr && (
              <p className="text-[11px] text-red-300 break-words">
                {actionErr}
              </p>
            )}
            {status && status !== "finalized" && (
              <p className="text-[10px] text-cream-100/45">
                Status: <span className="font-mono">{status}</span>
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
