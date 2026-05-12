import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { bucketFor, BUCKET_LABELS, type ScoreBucket } from "@/lib/stats";
import { strokesPerHole } from "@/lib/handicap";
import { formatHi } from "@/lib/handicap-format";
import { VenmoQR } from "@/components/VenmoQR";
import { PlayerProfileEditor } from "./profile-editor";
import { RivalryShareButton } from "./rivalry-share";
import {
  buildPartnerSignals,
  buildRivalrySignals,
  fmtMoneyCents,
  type ClubhouseRound,
  type ClubhouseRoundPlayer,
  type ClubhouseSettlement
} from "@/lib/clubhouse";

export default async function PlayerStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/players/${id}/stats`);

  const { data: player } = await sb
    .from("players")
    .select("id, group_id, display_name, handicap_index, ghin_number, email, phone, venmo_handle, ig_handle, x_handle, website_url, bio_line, avatar_url, profile_id, profiles(avatar_url, display_name)")
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
  // Players can edit their OWN profile (socials, bio, venmo handle, etc.)
  // even when they're not a commissioner. RLS already gates which rows
  // a non-commissioner can update server-side; this just decides whether
  // to show the editor in the UI. Commissioner edits anyone in the group.
  const isOwnProfile = player.profile_id === user.id;
  const canEdit = isCommissioner || isOwnProfile;

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

  // Best / worst rounds (gross, normalized to 18 holes equivalent so 9-hole
  // and 18-hole rounds compete fairly).
  const playable = roundLines.filter((r) => r.holes_played >= 9);
  const projectGross = (r: { gross: number; holes_played: number }) =>
    Math.round(r.gross * (18 / r.holes_played));
  const sortedByGross = playable.slice().sort((a, b) => projectGross(a) - projectGross(b));
  const bestRound = sortedByGross[0] ?? null;
  const worstRound = sortedByGross[sortedByGross.length - 1] ?? null;

  // Per-course breakdown — for every course the player has finalized
  // rounds at, show round count, average gross/18, vs-par.
  type CourseBucket = {
    name: string;
    rounds: number;
    holes: number;
    gross: number;
    vsParSum: number;
  };
  const byCourse = new Map<string, CourseBucket>();
  for (const r of roundLines) {
    const key = r.course;
    const e = byCourse.get(key) ?? { name: key, rounds: 0, holes: 0, gross: 0, vsParSum: 0 };
    e.rounds += 1;
    e.holes += r.holes_played;
    e.gross += r.gross;
    e.vsParSum += r.vsPar;
    byCourse.set(key, e);
  }
  const courseRows = [...byCourse.values()]
    .map((b) => ({
      name: b.name,
      rounds: b.rounds,
      avg18: b.holes ? +(b.gross * 18 / b.holes).toFixed(1) : null,
      avgVsPar: b.rounds ? +(b.vsParSum / b.rounds).toFixed(1) : null
    }))
    .sort((a, b) => b.rounds - a.rounds);

  // Partner + rivalry signals — uses the same clubhouse engine the
  // dashboard does, scoped to rounds this player participated in. We
  // pull every other rp in those rounds plus the settlement edges so
  // the engine can compute head-to-head W-L and partner W-L without
  // re-implementing the math here.
  const playerRoundIds = finalizedRps.map((rp: any) => rp.rounds.id);
  let partnerSignals: ReturnType<typeof buildPartnerSignals> = [];
  let rivalrySignals: ReturnType<typeof buildRivalrySignals> = [];
  let lifetimeUsd: { won: number; lost: number; vs: Map<string, number> } | null = null;
  if (playerRoundIds.length > 0) {
    const safeRoundIds = playerRoundIds.length
      ? playerRoundIds
      : ["00000000-0000-0000-0000-000000000000"];
    const [{ data: allRps }, { data: allSettles }] = await Promise.all([
      sb
        .from("round_players")
        .select("id, round_id, player_id, team_id, players(display_name)")
        .in("round_id", safeRoundIds),
      sb
        .from("settlements")
        .select(
          "round_id, from_round_player_id, to_round_player_id, amount_cents"
        )
        .in("round_id", safeRoundIds)
    ]);

    const chRounds: ClubhouseRound[] = finalizedRps.map((rp: any) => ({
      id: rp.rounds.id,
      date: rp.rounds.date,
      status: "finalized" as const,
      course_name: rp.rounds.courses?.name ?? null,
      course_id: null,
      spectator_token: null,
      holes: rp.rounds.holes ?? 18
    }));
    const chRps: ClubhouseRoundPlayer[] = ((allRps as any[]) ?? []).map((rp) => ({
      round_player_id: rp.id,
      round_id: rp.round_id,
      player_id: rp.player_id,
      display_name: rp.players?.display_name ?? "Player",
      team_id: rp.team_id ?? null
    }));
    const chSettles: ClubhouseSettlement[] = ((allSettles as any[]) ?? []).map(
      (s) => {
        const round = chRounds.find((r) => r.id === s.round_id);
        return {
          round_id: s.round_id,
          round_date: round?.date ?? "",
          from_round_player_id: s.from_round_player_id,
          to_round_player_id: s.to_round_player_id,
          amount_cents: s.amount_cents
        };
      }
    );

    // Filter signals down to ones involving THIS player.
    const allPartners = buildPartnerSignals(chRps, chSettles, chRounds, {
      minRounds: 1
    });
    partnerSignals = allPartners.filter(
      (p) => p.player_a_id === player.id || p.player_b_id === player.id
    );

    const allRivals = buildRivalrySignals(chRps, chSettles, chRounds, {
      minRounds: 2
    });
    rivalrySignals = allRivals.filter(
      (r) => r.player_a_id === player.id || r.player_b_id === player.id
    );

    // Lifetime $ vs each opponent — useful for "you owe / are owed by"
    // breakdowns. Keyed by opponent player_id, signed from THIS player's
    // perspective (positive = you've netted money off them).
    const vsMap = new Map<string, number>();
    const rpToPlayer = new Map(
      chRps.map((rp) => [rp.round_player_id, rp.player_id])
    );
    let totalWon = 0;
    let totalLost = 0;
    for (const s of chSettles) {
      const fromPid = rpToPlayer.get(s.from_round_player_id);
      const toPid = rpToPlayer.get(s.to_round_player_id);
      if (toPid === player.id && fromPid && fromPid !== player.id) {
        vsMap.set(fromPid, (vsMap.get(fromPid) ?? 0) + s.amount_cents);
        totalWon += s.amount_cents;
      } else if (fromPid === player.id && toPid && toPid !== player.id) {
        vsMap.set(toPid, (vsMap.get(toPid) ?? 0) - s.amount_cents);
        totalLost += s.amount_cents;
      }
    }
    lifetimeUsd = { won: totalWon, lost: totalLost, vs: vsMap };
  }

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
              const perRound = totals.rounds ? +(v / totals.rounds).toFixed(2) : 0;
              return (
                <div key={k}>
                  <div className="font-serif text-2xl text-cream-50 tabular-nums">{v}</div>
                  <div className="text-xs uppercase tracking-wide text-cream-100/55">{BUCKET_LABELS[k]}</div>
                  <div className="text-xs text-cream-100/40">{pct}% · {perRound}/rd</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Best / worst round */}
      {(bestRound || worstRound) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bestRound && (
            <div className="card p-4">
              <p className="h-eyebrow text-emerald-300">Best round</p>
              <div className="font-serif text-3xl text-cream-50 mt-1 tabular-nums">
                {projectGross(bestRound)}
                {bestRound.holes_played < 18 && <span className="text-sm text-cream-100/55"> (proj.)</span>}
              </div>
              <p className="text-xs text-cream-100/55 mt-0.5">
                {bestRound.course} · {bestRound.date}
                {bestRound.vsPar !== 0 && (
                  <> · <span className={bestRound.vsPar < 0 ? "text-emerald-300" : "text-red-300"}>
                    {bestRound.vsPar > 0 ? "+" : ""}{bestRound.vsPar}
                  </span></>
                )}
              </p>
            </div>
          )}
          {worstRound && worstRound !== bestRound && (
            <div className="card p-4">
              <p className="h-eyebrow text-red-300">Worst round</p>
              <div className="font-serif text-3xl text-cream-50 mt-1 tabular-nums">
                {projectGross(worstRound)}
                {worstRound.holes_played < 18 && <span className="text-sm text-cream-100/55"> (proj.)</span>}
              </div>
              <p className="text-xs text-cream-100/55 mt-0.5">
                {worstRound.course} · {worstRound.date}
                {worstRound.vsPar !== 0 && (
                  <> · <span className={worstRound.vsPar < 0 ? "text-emerald-300" : "text-red-300"}>
                    {worstRound.vsPar > 0 ? "+" : ""}{worstRound.vsPar}
                  </span></>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Per-course breakdown */}
      {courseRows.length > 1 && (
        <div className="card p-5">
          <h2 className="font-serif text-xl text-cream-50 mb-3">By course</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {courseRows.map((c) => (
              <li key={c.name} className="py-2 flex items-baseline justify-between gap-3">
                <span className="text-cream-50 truncate">{c.name}</span>
                <div className="text-right shrink-0">
                  <div className="text-cream-50 tabular-nums">
                    {c.avg18 != null ? `${c.avg18} avg` : "—"}
                  </div>
                  <div className="text-[11px] text-cream-100/55">
                    {c.rounds} round{c.rounds === 1 ? "" : "s"}
                    {c.avgVsPar != null && c.avgVsPar !== 0 && (
                      <> · <span className={c.avgVsPar < 0 ? "text-emerald-300" : "text-red-300"}>
                        {c.avgVsPar > 0 ? "+" : ""}{c.avgVsPar}
                      </span> vs par</>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Partner record — who they win/lose with as teammates. Shows up
          to 3 most-paired teammates. Tone discipline: stat lines, not
          "BEST DUO!!!". */}
      {partnerSignals.length > 0 && (
        <div className="card p-5">
          <h2 className="font-serif text-xl text-cream-50 mb-3">As partners</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {partnerSignals.slice(0, 3).map((p) => {
              const partnerName =
                p.player_a_id === player.id ? p.player_b_name : p.player_a_name;
              return (
                <li
                  key={`${p.player_a_id}|${p.player_b_id}`}
                  className="py-2 flex items-baseline justify-between gap-3"
                >
                  <span className="text-cream-50 truncate">{partnerName}</span>
                  <div className="text-right shrink-0">
                    <div className="text-cream-50 tabular-nums">
                      {p.wins}-{p.losses}
                      {p.pushes > 0 ? `-${p.pushes}` : ""}
                    </div>
                    <div className="text-[11px] text-cream-100/55">
                      {p.rounds} round{p.rounds === 1 ? "" : "s"}
                      {p.combined_cents !== 0 && (
                        <>
                          {" · "}
                          <span
                            className={
                              p.combined_cents > 0
                                ? "text-emerald-300"
                                : "text-red-300"
                            }
                          >
                            {p.combined_cents > 0 ? "+" : ""}
                            {fmtMoneyCents(p.combined_cents)}
                          </span>{" "}
                          combined
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Head-to-head record — top 3 most-played opponents. Sign on the
          recent_run is from A's perspective; we re-orient to THIS
          player's view. */}
      {rivalrySignals.length > 0 && (
        <div className="card p-5">
          <h2 className="font-serif text-xl text-cream-50 mb-3">Head to head</h2>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {rivalrySignals.slice(0, 5).map((r) => {
              const isA = r.player_a_id === player.id;
              const opponentName = isA ? r.player_b_name : r.player_a_name;
              const myWins = isA ? r.a_wins : r.b_wins;
              const theirWins = isA ? r.b_wins : r.a_wins;
              const myRun = isA ? r.recent_run : -r.recent_run;
              const dollars = lifetimeUsd?.vs.get(
                isA ? r.player_b_id : r.player_a_id
              );
              return (
                <li
                  key={`${r.player_a_id}|${r.player_b_id}`}
                  className="py-2 flex items-baseline justify-between gap-3"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-cream-50 truncate">{opponentName}</span>
                    {r.rounds_together >= 3 && (
                      <RivalryShareButton
                        playerAId={player.id}
                        playerBId={isA ? r.player_b_id : r.player_a_id}
                        playerAName={player.display_name}
                        playerBName={opponentName}
                        myWins={myWins}
                        theirWins={theirWins}
                      />
                    )}
                  </span>
                  <div className="text-right shrink-0">
                    <div className="text-cream-50 tabular-nums">
                      {myWins}-{theirWins}
                      {r.pushes > 0 ? `-${r.pushes}` : ""}
                    </div>
                    <div className="text-[11px] text-cream-100/55">
                      {r.rounds_together} round
                      {r.rounds_together === 1 ? "" : "s"}
                      {Math.abs(myRun) >= 2 && (
                        <>
                          {" · "}
                          <span
                            className={
                              myRun > 0 ? "text-emerald-300" : "text-red-300"
                            }
                          >
                            {myRun > 0 ? `won ${myRun} in a row` : `lost ${-myRun} in a row`}
                          </span>
                        </>
                      )}
                      {dollars !== undefined && dollars !== 0 && (
                        <>
                          {" · "}
                          <span
                            className={
                              dollars > 0 ? "text-emerald-300" : "text-red-300"
                            }
                          >
                            {dollars > 0 ? "+" : ""}
                            {fmtMoneyCents(dollars)}
                          </span>{" "}
                          lifetime
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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

      {/* Bio + social links — visible to every group member. The bio
          line and socials are read-only display here; only the
          commissioner gets the editor below (via PlayerProfileEditor).
          Renders nothing when no fields are set, so the page stays
          tight for players who haven't filled in any details. */}
      {(player.bio_line ||
        player.ig_handle ||
        player.x_handle ||
        player.website_url) && (
        <div className="card p-5 space-y-3">
          {player.bio_line && (
            <p className="text-sm text-cream-50 leading-snug">
              {player.bio_line}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {player.ig_handle && (
              <a
                href={`https://instagram.com/${player.ig_handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-900/40 border border-cream-100/15 px-3 py-1 hover:border-cream-100/30 transition-colors"
              >
                <span className="text-cream-100/55">Instagram</span>
                <span className="text-cream-50">@{player.ig_handle.replace(/^@/, "")}</span>
              </a>
            )}
            {player.x_handle && (
              <a
                href={`https://x.com/${player.x_handle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-900/40 border border-cream-100/15 px-3 py-1 hover:border-cream-100/30 transition-colors"
              >
                <span className="text-cream-100/55">X</span>
                <span className="text-cream-50">@{player.x_handle.replace(/^@/, "")}</span>
              </a>
            )}
            {player.website_url && (
              <a
                href={player.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-900/40 border border-cream-100/15 px-3 py-1 hover:border-cream-100/30 transition-colors"
              >
                <span className="text-cream-100/55">Web</span>
                <span className="text-cream-50 truncate max-w-[14rem]">
                  {player.website_url.replace(/^https?:\/\//, "")}
                </span>
              </a>
            )}
          </div>
        </div>
      )}

      {canEdit && (
        <PlayerProfileEditor
          playerId={player.id}
          initial={{
            display_name: player.display_name,
            email: player.email,
            phone: player.phone,
            ghin_number: player.ghin_number,
            handicap_index: player.handicap_index,
            venmo_handle: player.venmo_handle,
            avatar_url: player.avatar_url,
            ig_handle: player.ig_handle,
            x_handle: player.x_handle,
            website_url: player.website_url,
            bio_line: player.bio_line
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
