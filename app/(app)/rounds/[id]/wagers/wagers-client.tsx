"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

type Game = {
  id: string;
  game_type: string;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: any;
};

type Person = {
  profile_id: string;
  display_name: string;
  acked: boolean;
};

const fmtMoney = (cents: number) => "$" + (cents / 100).toFixed(2);

function describeGame(g: Game) {
  const parts: string[] = [];
  if (g.stake_cents > 0) parts.push(`Stake ${fmtMoney(g.stake_cents)}`);
  if (typeof g.config?.skin_value_cents === "number" && g.config.skin_value_cents > 0)
    parts.push(`${fmtMoney(g.config.skin_value_cents)} a skin`);
  if (g.config?.escalation === "double") parts.push("doubles on carry");
  if (g.config?.escalation === "linear") parts.push("linear carry");
  if (g.config?.require_birdie) parts.push("birdie validates");
  if (g.config?.presses === "auto_2_down") parts.push("auto-press 2-down");
  if (g.config?.presses === "manual") parts.push("manual presses");
  if (typeof g.config?.front_stake_cents === "number")
    parts.push(`F ${fmtMoney(g.config.front_stake_cents)} / B ${fmtMoney(g.config.back_stake_cents ?? g.stake_cents)} / O ${fmtMoney(g.config.overall_stake_cents ?? g.stake_cents)}`);
  if (g.allowance_pct !== 100) parts.push(`${g.allowance_pct}% hcp allowance`);
  return parts.join(" · ");
}

export function WagerAckClient({
  roundId,
  games,
  myAck,
  peopleStatus
}: {
  roundId: string;
  games: Game[];
  myAck: boolean;
  peopleStatus: Person[];
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [acked, setAcked] = useState(myAck);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ack() {
    setBusy(true);
    setErr(null);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      setBusy(false);
      setErr("Not signed in.");
      return;
    }
    const { error } = await sb
      .from("round_wager_acks")
      .upsert({ round_id: roundId, profile_id: user.id });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setAcked(true);
    router.refresh();
  }

  async function unack() {
    setBusy(true);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("round_wager_acks").delete().eq("round_id", roundId).eq("profile_id", user.id);
    setBusy(false);
    setAcked(false);
    router.refresh();
  }

  const moneyGames = games.filter((g) => g.stake_cents > 0 || (g.config?.skin_value_cents ?? 0) > 0);

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <div className="font-serif text-xl text-cream-50">The book</div>
        {moneyGames.length === 0 ? (
          <p className="text-sm text-cream-100/65">No money on this one — no wagers configured.</p>
        ) : (
          <ul className="divide-y divide-cream-100/8">
            {moneyGames.map((g) => (
              <li key={g.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-cream-50 font-medium">{g.name}</div>
                  <div className="text-xs text-cream-100/60 mt-0.5">{describeGame(g)}</div>
                </div>
                <div className="font-serif text-2xl tabular-nums text-[#FFCD00] shrink-0">
                  {g.stake_cents > 0 ? fmtMoney(g.stake_cents) : fmtMoney(g.config?.skin_value_cents ?? 0) + "/skin"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <div className="font-serif text-lg text-cream-50">Handshake</div>
        <p className="text-sm text-cream-100/65 mt-1">
          You agree to the stakes above and to settle up with whoever comes out on top.
        </p>
        {err && <p className="text-sm text-red-300 mt-2">{err}</p>}
        <div className="mt-4">
          {acked ? (
            <div className="flex items-center gap-3">
              <div className="pill-final">✓ Confirmed</div>
              <button className="btn-ghost text-xs" disabled={busy} onClick={unack}>Withdraw</button>
            </div>
          ) : (
            <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={ack}>
              {busy ? "Locking it in…" : "I'm in — confirm wagers"}
            </button>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="font-serif text-lg text-cream-50">Who&apos;s in</div>
        <ul className="mt-3 divide-y divide-cream-100/8">
          {peopleStatus.length === 0 && <li className="text-sm text-cream-100/55 py-2">No invitees yet.</li>}
          {peopleStatus.map((p) => (
            <li key={p.profile_id} className="py-2 flex items-center justify-between">
              <span className="text-cream-50">{p.display_name}</span>
              <span className={p.acked ? "pill-live" : "pill-draft"}>
                {p.acked ? "Confirmed" : "Pending"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
