import Link from "next/link";
import { VenmoQR } from "@/components/VenmoQR";
import { DEMO_PROFILES, DEMO_RECENT_ROUNDS } from "@/lib/demo";
import { BUCKET_LABELS, type ScoreBucket } from "@/lib/stats";

export default async function DemoProfilePage({
  searchParams
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const id = sp.p && DEMO_PROFILES[sp.p] ? sp.p : "p-cruz";
  const player = DEMO_PROFILES[id];

  const fmtUsd = (cents: number) =>
    (cents > 0 ? "+" : cents < 0 ? "−" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-4">
          <Avatar name={player.display_name} />
          <div>
            <p className="h-eyebrow">Player</p>
            <h1 className="h-display text-4xl text-cream-50 mt-1">{player.display_name}</h1>
            <p className="text-sm text-cream-100/55">
              HI {player.handicap_index}
              {player.ghin_number && ` · GHIN ${player.ghin_number}`}
            </p>
          </div>
        </div>
        <Link href="/demo" className="btn-ghost text-sm">← Demo home</Link>
      </header>

      {/* Quick switcher */}
      <div className="flex flex-wrap gap-2">
        {Object.values(DEMO_PROFILES).map((p) => (
          <Link
            key={p.id}
            href={`/demo/profile?p=${p.id}`}
            className={`btn text-xs ${
              p.id === id
                ? "bg-cream-100 text-brand-900"
                : "bg-brand-900/60 border border-cream-100/12 text-cream-100/80"
            }`}
          >
            {p.display_name}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Rounds" value={player.rounds_played} />
        <Stat label="Avg gross / 18" value={player.avg_gross_18.toFixed(1)} />
        <Stat label="Avg net / 18" value={player.avg_net_18.toFixed(1)} />
        <Stat
          label="Season net"
          value={fmtUsd(player.season_net_cents)}
          hint={`across ${player.rounds_played} rounds`}
        />
        <Stat
          label="Avg @ JGCC"
          value={player.jgcc_avg.toFixed(1)}
          hint={`${player.rounds_jgcc} rounds`}
        />
        <Stat label="Holes played" value={player.total_holes} />
      </div>

      <div className="card p-5">
        <h2 className="font-serif text-xl text-cream-50 mb-3">Scoring distribution</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {(Object.keys(player.buckets) as ScoreBucket[]).map((k) => {
            const v = player.buckets[k];
            const pct = player.total_holes ? Math.round((v / player.total_holes) * 100) : 0;
            return (
              <div key={k}>
                <div className="font-serif text-2xl text-cream-50 tabular-nums">{v}</div>
                <div className="text-xs uppercase tracking-wide text-cream-100/55">{BUCKET_LABELS[k]}</div>
                <div className="text-xs text-cream-100/40">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-5 flex flex-col sm:flex-row items-start gap-5">
        <div className="flex-1">
          <h2 className="font-serif text-xl text-cream-50">Venmo</h2>
          <p className="text-sm text-cream-100/65 mt-1">
            Scan to pay <span className="text-cream-50">@{player.venmo_handle}</span>
            {player.season_net_cents < 0 && (
              <>
                {" "}— currently owes{" "}
                <span className="text-red-300">${(Math.abs(player.season_net_cents) / 100).toFixed(2)}</span>
              </>
            )}
            {player.season_net_cents > 0 && (
              <>
                {" "}— currently owed{" "}
                <span className="text-emerald-300">${(player.season_net_cents / 100).toFixed(2)}</span>
              </>
            )}
          </p>
          <a
            className="btn-secondary text-xs mt-3"
            href={`https://venmo.com/${player.venmo_handle}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on Venmo →
          </a>
        </div>
        <VenmoQR
          handle={player.venmo_handle}
          amount={player.season_net_cents < 0 ? Math.abs(player.season_net_cents) / 100 : undefined}
          note="Cruz Golf settlement"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-cream-100/10 font-serif text-lg text-cream-50">
          Recent rounds
        </div>
        <ul>
          {DEMO_RECENT_ROUNDS.map((r) => (
            <li
              key={r.id}
              className="px-5 py-3 border-b border-cream-100/5 last:border-b-0 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-cream-50 truncate">{r.course}</div>
                <div className="text-xs text-cream-100/55">{r.date} · 18 holes</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-serif text-2xl tabular-nums text-cream-50">{r.gross}</div>
                <div className={`text-xs tabular-nums ${r.vsPar < 0 ? "text-red-400" : "text-cream-100/55"}`}>
                  {r.vsPar > 0 ? `+${r.vsPar}` : r.vsPar === 0 ? "E" : r.vsPar} · net {r.net}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="w-[72px] h-[72px] rounded-full bg-brand-800 ring-2 ring-gold-500/50 flex items-center justify-center font-serif text-2xl text-cream-50 shrink-0">
      {initials || "·"}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="font-serif text-3xl text-cream-50 tabular-nums">{value}</div>
      <div className="h-eyebrow mt-1">{label}</div>
      {hint && <div className="text-xs text-cream-100/40 mt-0.5">{hint}</div>}
    </div>
  );
}
