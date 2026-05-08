"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function JoinForm({
  roundId,
  inviteToken,
  hasValidInvite
}: {
  roundId: string;
  inviteToken: string | null;
  hasValidInvite: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function redeemInvite() {
    if (!inviteToken) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await sb.rpc("fn_redeem_invite", { p_token: inviteToken });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    if (!data) {
      setErr("Invite could not be redeemed.");
      return;
    }
    router.push(`/rounds/${roundId}`);
    router.refresh();
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { data, error } = await sb.rpc("fn_join_round", { p_round_id: roundId, p_pin: pin });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data !== true) return setErr("Wrong PIN. Ask Cruz for the correct code.");
    router.push(`/rounds/${roundId}`);
    router.refresh();
  }

  if (hasValidInvite) {
    return (
      <button className="btn-primary w-full" disabled={busy} onClick={redeemInvite}>
        {busy ? "Joining…" : "Accept invite & join"}
        {err && <span className="sr-only">{err}</span>}
      </button>
    );
  }

  return (
    <form onSubmit={submitPin} className="space-y-3">
      <div>
        <label className="label">Round PIN</label>
        <input
          className="input text-center text-3xl font-serif tracking-[0.4em] py-4"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          pattern="[0-9]{4}"
          placeholder="0000"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
          autoFocus
          required
        />
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || pin.length !== 4}>
        {busy ? "Checking…" : "Join round"}
      </button>
    </form>
  );
}
