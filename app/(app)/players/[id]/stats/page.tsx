import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { bucketFor, BUCKET_LABELS, type ScoreBucket } from "@/lib/stats";
import { strokesPerHole } from "@/lib/handicap";
import { formatHi } from "@/lib/handicap-format";
import { VenmoQR } from "@/components/VenmoQR";
import { PlayerProfileEditor } from "./profile-editor";

export default async function PlayerStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/players/${id}/stats`);

  const { data: player } = await sb
    .from("players")
    .select("id, group_id, display_name, handicap_index, ghin_number, email, phone, venmo_handle, avatar_url, profile_id, profiles(avatar_url, display_name)")
    .eq("id", id)
    .single();
  if (!player) redirect("/players");

  // Commissioner check (for edit affordance).
  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", player.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const isCommissioner = gm?.role === "commissioner";

  const photo: string | null =
    (player as any).avatar_url || (player as any).profiles?.avatar_url || null;

  // Stats aggregation (same as before).
  const { data: rps } = await sb
    .from("round_players")
    .select(`
      id, course_handicap, playing_handicap,
      rounds!inner(id, date, status, holes, courses(name)),
      course_tees(course_holes(hole_number, par, stroke_index))
    `)
    .eq("player_id", id);

  const finalizedRps = (rps ?? []).filter((rp: any) => rp.rounds?.status === "finalized");
  const rpIds = finalizedRps.map((rp: any) => rp.id);

  const { data: scores } = rpIds.length
    ? await sb
        .from("scores")
        .select("round_player_id, hole_number, gross")
        .in("round_player_id", rpIds)
    : { data: [] as any[] };

  const totals = {
    rounds: 0,
    rounds_jgcc: 0,
    holes_played: 0,
    gross_sum: 0,
    net_sum: 0,
    par_played: 0,
    jgcc_gross_sum: 0,
    jgcc_par_played: 0
  };
  const buckets: Record<ScoreBucket, number> = {
    eagle_or_better: 0, birdie: 0, par: 0, bogey: 0, double: 0, other: 0
  };

  type RoundLine = {
    id: string; date: string; course: string; holes_played: number;
    gross: number; net: number; vsPar: number;
  };
  const roundLines: RoundLine[] = [];

  for (const rp of finalizedRps as any[]) {
    const holes = (rp.course_tees?.course_holes ?? []).slice().sort((a: any, b: any) => a.hole_number - b.hole_number);
    const stk = strokesPerHole(rp.playing_handicap ?? 0, holes);
    const rpScores = (scores ?? []).filter((s: any) => s.round_player_id === rp.id);

    let g = 0, n = 0, played = 0, parTot = 0;
    let jgccGross = 0, jgccPar = 0;
    const isJgcc = (rp.rounds?.courses?.name ?? "").toLowerCase().includes("jacksonville golf");

    for (const h of holes) {
      const sc = rpScores.find((s: any) => s.hole_number === h.hole_number);
      if (sc?.gross == null) continue;
      played += 1;
      g += sc.gross;
      const idx = holes.findIndex((x: any) => x.hole_number === h.hole_number);
      n += sc.gross - (stk[idx] ?? 0);
      parTot += h.par;
      buckets[bucketFor(sc.gross, h.par)] += 1;
      if (isJgcc) { jgccGross += sc.gross; jgccPar += h.par; }
    }
    if (played === 0) continue;

    totals.rounds += 1;
    totals.holes_played += played;
    totals.gross_sum += g;
    totals.net_sum += n;
    totals.par_played += parTot;
    if (isJgcc) {
      totals.rounds_jgcc += 1;
      totals.jgcc_gross_sum += jgccGross;
      totals.jgcc_par_played += jgccPar;
    }
    roundLines.push({
      id: rp.rounds.id,
      date: rp.rounds.date,
      course: rp.rounds.courses?.name ?? "—",
      holes_played: played,
      gross: g,
      net: n,
      vsPar: g - parTot
    });
  }

  roundLines.sort((a, b) => (a.date < b.date ? 1 : -1));

  const grossPer18 = totals.holes_played
    ? +(totals.gross_sum * 18 / totals.holes_played).toFixed(1)
    : null;
  const netPer18 = totals.holes_played
    ? +(totals.net_sum * 18 / totals.holes_played).toFixed(1)
    : null;
  const jgccGrossPer18 = (() => {
    if (totals.rounds_jgcc === 0 || totals.jgcc_par_played === 0) return null;
    const holesEquiv = totals.jgcc_par_played / 4;
    return +(totals.jgcc_gross_sum * 18 / holesEquiv).toFixed(1);
  })();

  // Settle ledger across this player's finalized rounds in their group.
  // (Fast read of settlements paying or receiving)
  const { data: settle } = rpIds.length
    ? await sb
        .from("settlements")
        .select("from_round_player_id, to_round_player_id, amount_cents")
        .or(`from_round_player_id.in.(${rpIds.join(",")}),to_round_player_id.in.(${rpIds.join(",")})`)
    : { data: [] as any[] };
  let netCents = 0;
  for (const s of (settle ?? []) as any[]) {
    if (rpIds.includes(s.from_round_player_id)) netCents -= s.amount_cents;
    if (rpIds.includes(s.to_round_player_id)) netCents += s.amount_cents;
  }
  const netUsd = (cents: number) => (cents > 0 ? "+" : cents < 0 ? "−" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-4">
          <Avatar src={photo} name={player.display_name} />
          <div>
            <p className="h-eyebrow">Player</p>
            <h1 className="h-display text-4xl text-cream-50 mt-1">{player.display_name}</h1>
            <p className="text-sm text-cream-100/55">
              HI {formatHi(player.handicap_index)}
              {player.ghin_number && ` · GHIN ${player.ghin_number}`}
            </p>
          </div>
        </div>
        <Link href="/players" className="btn-ghost text-sm">← Players</Link>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Rounds" value={totals.rounds} />
        <Stat label="Avg gross / 18" value={grossPer18 ?? "—"} />
        <Stat label="Avg net / 18" value={netPer18 ?? "—"} />
        <Stat label="Season net" value={netUsd(netCents)} hint={`across ${totals.rounds} round${totals.rounds === 1 ? "" : "s"}`} />
        <Stat label="Avg @ JGCC" value={jgccGrossPer18 ?? "—"} hint={`${totals.rounds_jgcc} round${totals.rounds_jgcc === 1 ? "" : "s"}`} />
        <Stat label="Holes played" value={totals.holes_played} />
      </div>

      {totals.rounds > 0 && (
        <div className="card p-5">
          <h2 className="font-serif text-xl text-cream-50 mb-3">Scoring distribution</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {(Object.keys(buckets) as ScoreBucket[]).map((k) => {
              const v = buckets[k];
              const pct = totals.holes_played ? Math.round((v / totals.holes_played) * 100) : 0;
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
      )}

      {/* Venmo */}
      <div className="card p-5 flex flex-col sm:flex-row items-start gap-5">
        <div className="flex-1">
          <h2 className="font-serif text-xl text-cream-50">Venmo</h2>
          {player.venmo_handle ? (
            <>
              <p className="text-sm text-cream-100/65 mt-1">
                Scan to pay <span className="text-cream-50">@{player.venmo_handle.replace(/^@/, "")}</span>
                {netCents < 0 && <> — currently owes <span className="text-red-300">${(Math.abs(netCents) / 100).toFixed(2)}</span></>}
                {netCents > 0 && <> — currently owed <span className="text-emerald-300">${(netCents / 100).toFixed(2)}</span></>}
              </p>
              <a
                className="btn-secondary text-xs mt-3"
                href={`https://venmo.com/${player.venmo_handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open on Venmo →
              </a>
            </>
          ) : (
            <p className="text-sm text-cream-100/55 mt-1">No Venmo handle on file.</p>
          )}
        </div>
        {player.venmo_handle && (
          <VenmoQR
            handle={player.venmo_handle}
            amount={netCents < 0 ? Math.abs(netCents) / 100 : undefined}
            note={`Cruz Golf settlement`}
          />
        )}
      </div>

      {isCommissioner && (
        <PlayerProfileEditor
          playerId={player.id}
          initial={{
            display_name: player.display_name,
            email: player.email,
            phone: player.phone,
            ghin_number: player.ghin_number,
            handicap_index: player.handicap_index,
            venmo_handle: player.venmo_handle,
            avatar_url: player.avatar_url
          }}
        />
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-cream-100/10 font-serif text-lg text-cream-50">Recent rounds</div>
        {roundLines.length === 0 ? (
          <p className="px-5 py-6 text-sm text-cream-100/55">No finalized rounds yet.</p>
        ) : (
          <ul>
            {roundLines.slice(0, 25).map((r) => (
              <li key={r.id} className="px-5 py-3 border-b border-cream-100/5 last:border-b-0 flex items-center justify-between gap-3">
                <Link href={`/rounds/${r.id}`} className="flex-1 min-w-0 hover:opacity-90">
                  <div className="text-cream-50 truncate">{r.course}</div>
                  <div className="text-xs text-cream-100/55">{r.date} · {r.holes_played} holes</div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="font-serif text-2xl tabular-nums text-cream-50">{r.gross}</div>
                  <div className={`text-xs tabular-nums ${r.vsPar < 0 ? "text-red-400" : "text-cream-100/55"}`}>
                    {r.vsPar > 0 ? `+${r.vsPar}` : r.vsPar === 0 ? "E" : r.vsPar} · net {r.net}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={72} height={72} className="rounded-full object-cover ring-2 ring-gold-500/50 shrink-0" />;
  }
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
