import Link from "next/link";
import { DEMO_PROFILES } from "@/lib/demo";

export default function DemoLedgerPage() {
  const rows = Object.values(DEMO_PROFILES)
    .map((p) => ({
      pid: p.id,
      name: p.display_name,
      rounds: p.rounds_played,
      net: p.season_net_cents,
      venmo: p.venmo_handle
    }))
    .sort((a, b) => b.net - a.net);

  const fmt = (cents: number) =>
    (cents > 0 ? "+" : cents < 0 ? "−" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);

  // Compute the minimal-flow "who pays whom" for the demo ledger.
  const balances = rows.map((r) => ({ id: r.pid, name: r.name, venmo: r.venmo, v: r.net }));
  const flows: Array<{ from: string; from_venmo: string; to: string; to_venmo: string; amount: number }> = [];
  while (true) {
    balances.sort((a, b) => a.v - b.v);
    const debtor = balances[0];
    const creditor = balances[balances.length - 1];
    if (!debtor || !creditor || debtor.v >= 0 || creditor.v <= 0) break;
    const amt = Math.min(-debtor.v, creditor.v);
    flows.push({
      from: debtor.name,
      from_venmo: debtor.venmo,
      to: creditor.name,
      to_venmo: creditor.venmo,
      amount: amt
    });
    debtor.v += amt;
    creditor.v -= amt;
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow">Season ledger</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Who&apos;s up, who&apos;s down</h1>
          <p className="text-sm text-cream-100/55 mt-1">All finalized rounds in Saturday Crew this season.</p>
        </div>
        <Link href="/demo" className="btn-ghost text-sm">← Demo home</Link>
      </header>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[44px_1fr_72px_120px] sm:grid-cols-[56px_1fr_100px_140px] px-4 py-2.5 border-b border-cream-100/10 text-[10px] uppercase tracking-[0.18em] text-cream-100/45 bg-brand-900/40">
          <div>Pos</div>
          <div>Player</div>
          <div className="text-right">Rounds</div>
          <div className="text-right">Net</div>
        </div>
        <ol>
          {rows.map((r, i) => (
            <li
              key={r.pid}
              className="grid grid-cols-[44px_1fr_72px_120px] sm:grid-cols-[56px_1fr_100px_140px] items-center px-4 py-3 border-b border-cream-100/5 last:border-b-0"
            >
              <div className="font-serif text-2xl text-gold-500 tabular-nums">{i + 1}</div>
              <Link
                href={`/demo/profile?p=${r.pid}`}
                className="font-serif text-lg sm:text-xl text-cream-50 hover:underline truncate pr-2"
              >
                {r.name}
              </Link>
              <div className="text-right tabular-nums text-cream-100/65 text-sm">{r.rounds}</div>
              <div
                className={`text-right font-serif tabular-nums text-2xl sm:text-3xl leading-none ${
                  r.net > 0 ? "text-emerald-300" : r.net < 0 ? "text-red-400" : "text-cream-100/70"
                }`}
              >
                {fmt(r.net)}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card p-5">
        <h2 className="font-serif text-xl text-cream-50">Settle the season — minimum transfers</h2>
        <p className="text-xs text-cream-100/55 mt-1">
          Tap a row to open the payer&apos;s Venmo with the amount pre-filled.
        </p>
        {flows.length === 0 ? (
          <p className="text-sm text-cream-100/55 mt-3">Nothing owed.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {flows.map((f, i) => (
              <li
                key={i}
                className="surface rounded-xl px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <span className="font-medium text-cream-50">{f.from}</span>
                  <span className="text-cream-100/45 mx-2">→</span>
                  <span className="font-medium text-cream-50">{f.to}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-serif text-xl tabular-nums text-cream-50">
                    ${(f.amount / 100).toFixed(2)}
                  </span>
                  <a
                    className="btn-primary text-xs"
                    href={`https://venmo.com/${f.to_venmo}?txn=pay&amount=${(f.amount / 100).toFixed(2)}&note=${encodeURIComponent("Cruz Golf settlement")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Pay
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
