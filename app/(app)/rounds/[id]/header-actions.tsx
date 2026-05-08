"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = {
  roundId: string;
  spectatorToken: string;
  pin: string | null;
  accessMode: "invited" | "open_to_group";
  isCommissioner: boolean;
};

export function RoundHeaderActions({ roundId, spectatorToken, pin, accessMode, isCommissioner }: Props) {
  const [showPin, setShowPin] = useState(false);
  const [mode, setMode] = useState(accessMode);
  const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();

  function copy(text: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      // Lightweight feedback — no toast lib for now.
      // eslint-disable-next-line no-alert
      alert(`${label} copied`);
    }
  }

  async function setAccessMode(next: "invited" | "open_to_group") {
    setBusy(true);
    const { error } = await sb.from("rounds").update({ access_mode: next }).eq("id", roundId);
    setBusy(false);
    if (!error) setMode(next);
  }

  const spectatorUrl = typeof window !== "undefined"
    ? `${window.location.origin}/rounds/${roundId}/leaderboard?token=${spectatorToken}`
    : "";
  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/rounds/${roundId}/join`
    : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isCommissioner && pin && (
        <button
          onClick={() => setShowPin((v) => !v)}
          className="surface rounded-xl px-3 py-2 inline-flex items-center gap-3 hover:bg-brand-900/80 transition-colors"
          aria-label="Toggle round PIN"
        >
          <span className="h-eyebrow">PIN</span>
          <span className="font-serif text-2xl tracking-[0.3em] text-cream-50 tabular-nums">
            {showPin ? pin : "••••"}
          </span>
        </button>
      )}
      {isCommissioner && (
        <button
          className="btn-secondary text-xs"
          onClick={() => copy(`Cruz Golf round PIN: ${pin}\n${joinUrl}`, "Invite link + PIN")}
        >
          Copy invite
        </button>
      )}
      <button
        className="btn-secondary text-xs"
        onClick={() => copy(spectatorUrl, "Spectator link")}
      >
        Spectator link
      </button>
      <a
        className="btn-secondary text-xs"
        href={`/api/share/round/${roundId}/image?token=${spectatorToken}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Share image
      </a>
      {isCommissioner && (
        <select
          className="input w-auto text-xs py-2"
          value={mode}
          disabled={busy}
          onChange={(e) => setAccessMode(e.target.value as any)}
          aria-label="Access mode"
        >
          <option value="invited">PIN required</option>
          <option value="open_to_group">Open to group</option>
        </select>
      )}
      {isCommissioner && (
        <Link href={`/rounds/${roundId}/invites`} className="btn-secondary text-xs">
          Invites
        </Link>
      )}
      {isCommissioner && (
        <Link href={`/rounds/${roundId}/upload`} className="btn-secondary text-xs">
          Upload card photo
        </Link>
      )}
      {isCommissioner && (
        <Link href={`/rounds/${roundId}/finalize`} className="btn-primary text-xs">
          Finalize
        </Link>
      )}
    </div>
  );
}
