"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Player = {
  player_id: string;
  display_name: string;
  is_unclaimed: boolean;
  round_player_id: string;
};

export function ClaimBanner({
  roundId,
  candidates
}: {
  roundId: string;
  candidates: Player[];
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (candidates.length === 0) return null;

  async function claim(p: Player) {
    setBusy(p.player_id);
    setErr(null);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      setBusy(null);
      setErr("Not signed in.");
      return;
    }
    // Only claim if the player is unlinked. RLS still applies — the user
    // must be a group member to update the row.
    const { error } = await sb
      .from("players")
      .update({ profile_id: user.id })
      .eq("id", p.player_id)
      .is("profile_id", null);
    setBusy(null);
    if (error) {
      setErr(error.message);
      return;
    }
    setDismissed(true);
    router.refresh();
  }

  return (
    <div className="card p-4 border border-gold-500/40 bg-brand-900/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-serif text-lg text-cream-50">Claim your spot</div>
          <p className="text-xs text-cream-100/65 mt-1">
            Tap the name that&apos;s you. We&apos;ll link it to your account so your scores and stats track to the right player.
          </p>
        </div>
        <button onClick={() => setDismissed(true)} className="btn-ghost text-xs" aria-label="Dismiss">
          Dismiss
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((p) => (
          <button
            key={p.player_id}
            disabled={!!busy}
            onClick={() => claim(p)}
            className="btn-secondary text-sm"
          >
            {busy === p.player_id ? "Claiming…" : `I'm ${p.display_name}`}
          </button>
        ))}
      </div>
      {err && <p className="text-xs text-red-300 mt-2">{err}</p>}
    </div>
  );
}
