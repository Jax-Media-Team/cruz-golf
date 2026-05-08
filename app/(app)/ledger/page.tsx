import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function LedgerPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/ledger");

  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  const groupId = groups?.[0]?.id;
  if (!groupId) {
    return (
      <div className="card p-8 text-center text-cream-100/65">
        No group yet. <Link href="/dashboard" className="text-cream-50 underline">Dashboard</Link>
      </div>
    );
  }

  const { data: rounds } = await sb
    .from("rounds")
    .select("id, date, status, courses(name), round_players(id, players(id, display_name))")
    .eq("group_id", groupId)
    .eq("status", "finalized")
    .order("date", { ascending: false });

  const finalizedRounds = rounds ?? [];

  // Collect settlements for all rounds.
  const allRoundIds = finalizedRounds.map((r: any) => r.id);
  const { data: settlements } = allRoundIds.length
    ? await sb
        .from("settlements")
        .select("round_id, from_round_player_id, to_round_player_id, amount_cents, breakdown")
        .in("round_id", allRoundIds)
    : { data: [] as any[] };

  // Build per-player totals across all finalized rounds in this group.
  const totals = new Map<string, { name: string; net_cents: number; rounds: number; wins: number }>();

  // Map round_player_id -> player_id + name for lookup.
  const rpToPlayer = new Map<string, { player_id: string; name: string }>();
  for (const r of finalizedRounds) {
    for (const rp of (r as any).round_players ?? []) {
      const pid = rp.players?.id ?? rp.id;
      const name = rp.players?.display_name ?? "Player";
      rpToPlayer.set(rp.id, { player_id: pid, name });
      if (!totals.has(pid)) totals.set(pid, { name, net_cents: 0, rounds: 0, wins: 0 });
    }
  }

  // Track rounds played per player.
  for (const r of finalizedRounds) {
    for (const rp of (r as any).round_players ?? []) {
      const pid = rp.players?.id ?? rp.id;
      const t = totals.get(pid);
      if (t) t.rounds += 1;
    }
  }

  // Apply settlements.
  for (const s of (settlements ?? []) as any[]) {
    const from = rpToPlayer.get(s.from_round_player_id);
    const to = rpToPlayer.get(s.to_round_player_id);
    if (from && totals.has(from.player_id)) {
      totals.get(from.player_id)!.net_cents -= s.amount_cents;
    }
    if (to && totals.has(to.player_id)) {
      totals.get(to.player_id)!.net_cents += s.amount_cents;
      totals.get(to.player_id)!.wins += 1;
    }
  }

  const rows = [...totals.entries()]
    .map(([pid, t]) => ({ pid, ...t }))
    .sort((a, b) => b.net_cents - a.net_cents);

  const fmt = (cents: number) => {
    const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
    return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="h-eyebrow">Season ledger</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Who&apos;s up, who&apos;s down</h1>
          <p className="text-sm text-cream-100/55 mt-1">
            All finalized rounds in {groups?.[0]?.name}.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-cream-100/65">
          Nothing finalized yet. Settle a round and it&apos;ll show up here.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[44px_1fr_80px_120px] sm:grid-cols-[56px_1fr_100px_140px] px-4 py-2.5 border-b border-cream-100/10 text-[10px] uppercase tracking-[0.18em] text-cream-100/45 bg-brand-900/40">
            <div>Pos</div>
            <div>Player</div>
            <div className="text-right">Rounds</div>
            <div className="text-right">Net</div>
          </div>
          <ol>
            {rows.map((r, i) => (
              <li
                key={r.pid}
                className="grid grid-cols-[44px_1fr_80px_120px] sm:grid-cols-[56px_1fr_100px_140px] items-center px-4 py-3 border-b border-cream-100/5 last:border-b-0"
              >
                <div className="font-serif text-2xl text-[#D9AD2C] tabular-nums">{i + 1}</div>
                <Link href={`/players/${r.pid}/stats`} className="font-serif text-lg sm:text-xl text-cream-50 hover:underline truncate pr-2">
                  {r.name}
                </Link>
                <div className="text-right tabular-nums text-cream-100/65 text-sm">{r.rounds}</div>
                <div
                  className={`text-right font-serif tabular-nums text-2xl sm:text-3xl leading-none ${r.net_cents > 0 ? "text-emerald-300" : r.net_cents < 0 ? "text-red-400" : "text-cream-100/70"}`}
                >
                  {fmt(r.net_cents)}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="font-serif text-xl text-cream-50">Recent settlements</h2>
        {finalizedRounds.length === 0 && <p className="text-sm text-cream-100/55">No finalized rounds.</p>}
        {finalizedRounds.slice(0, 12).map((r: any) => (
          <Link key={r.id} href={`/rounds/${r.id}`} className="card card-hover p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-cream-50">{r.courses?.name}</div>
              <div className="text-sm text-cream-100/55">{r.date}</div>
            </div>
            <span className="pill-final">Final</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
