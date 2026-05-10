"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ShareSheet } from "@/components/ShareSheet";

type Props = {
  roundId: string;
  spectatorToken: string;
  pin: string | null;
  accessMode: "invited" | "open_to_group";
  isCommissioner: boolean;
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
export function RoundHeaderActions({ roundId, spectatorToken, pin, accessMode, isCommissioner }: Props) {
  const [showPin, setShowPin] = useState(false);
  const [mode, setMode] = useState(accessMode);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const sb = supabaseBrowser();

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
    </div>
  );
}
