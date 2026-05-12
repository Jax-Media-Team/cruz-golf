"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { minimumFlow, settleGame } from "@/lib/games";
import { settleManualPress, type ManualPress, type HoleResult } from "@/lib/games/press";
import {
  settleJunk,
  categoryLabel,
  type JunkCategory,
  type JunkItem
} from "@/lib/games/junk";
import { buildPlayerSheet } from "@/lib/scoring";
import { generateRecap } from "@/lib/recap";
import {
  cleanHandle,
  venmoNoteForRound,
  venmoPayUrl
} from "@/lib/profile-format";
import { SmackTalk } from "@/components/SmackTalk";
import { ShareSheet } from "@/components/ShareSheet";
import type { CourseHole, RoundGame, RoundPlayer, Score } from "@/lib/types";

type ManualPressRow = ManualPress & {
  status: string;
  game_id: string | null;
};

type JunkItemRow = {
  id: string;
  round_player_id: string;
  hole_number: number;
  category: JunkCategory;
  custom_label: string | null;
  amount_cents: number;
  created_at: string;
  note: string | null;
};

export function FinalizeView({
  roundId,
  rps,
  scores,
  games,
  manualPresses = [],
  pendingPressCount = 0,
  junkItems = [],
  totalHoles = 18,
  startingHole = 1,
  courseName = null,
  roundDate = null,
  spectatorToken = null
}: {
  roundId: string;
  rps: any[];
  scores: Score[];
  games: any[];
  manualPresses?: ManualPressRow[];
  /** Pending presses still inside the 24h accept window. Surfaced as a
   *  warning banner — finalize would silently drop them. */
  pendingPressCount?: number;
  /** Junk side-bet items, non-deleted only. Settled via the pure-
   *  function engine and composed into the per-player totals. */
  junkItems?: JunkItemRow[];
  totalHoles?: 9 | 18;
  startingHole?: number;
  /** Course + date are used to compose the Venmo note ("Cruz Golf ·
   *  JGCC · May 12"). Null = falls back to "Cruz Golf settlement". */
  courseName?: string | null;
  roundDate?: string | null;
  /** Spectator-link token for the round. Required by the share URL —
   *  the public /rounds/[id]/leaderboard page rejects requests without
   *  it. Null disables the Share button. */
  spectatorToken?: string | null;
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const players: RoundPlayer[] = useMemo(
    () =>
      rps.map((r: any) => ({
        id: r.id,
        player_id: r.player_id,
        display_name: r.players?.display_name ?? "Player",
        tee_id: r.tee_id,
        tee: {
          id: r.course_tees?.id ?? r.tee_id,
          name: r.course_tees?.name ?? "",
          rating: r.course_tees?.rating ?? 72,
          slope: r.course_tees?.slope ?? 113,
          par: r.course_tees?.par ?? 72,
          holes: (r.course_tees?.course_holes ?? []).slice().sort((a: CourseHole, b: CourseHole) => a.hole_number - b.hole_number)
        },
        handicap_index_used: 0,
        course_handicap: r.course_handicap,
        playing_handicap: r.playing_handicap,
        team_id: r.team_id
      })),
    [rps]
  );
  const holes = players[0]?.tee?.holes ?? [];

  const totals = new Map<string, number>();
  const lines: Array<{ game: string; perPlayer: Map<string, number> }> = [];
  // Per-game settle errors — caught + surfaced in the UI banner
  // instead of throwing in the render pass. Without the try/catch,
  // a per-game engine that fails `assertZeroSum` on stale state
  // (e.g. a player added after some scoring was written, and the
  // engine doesn't seed them at 0) would crash the whole finalize
  // page with no recovery path.
  const gameErrors: string[] = [];
  for (const g of games) {
    try {
      const out = settleGame({
        game: g as RoundGame,
        players,
        scores,
        course: { holes, par: holes.reduce((s, h) => s + h.par, 0) },
        totalHoles,
        startingHole
      });
      const m = new Map<string, number>();
      for (const [pid, v] of out.perPlayer) {
        totals.set(pid, (totals.get(pid) ?? 0) + v.delta_cents);
        m.set(pid, v.delta_cents);
      }
      lines.push({ game: g.name, perPlayer: m });
    } catch (e: any) {
      gameErrors.push(
        `${g.name}: ${e?.message ?? "settle failed"}`
      );
    }
  }

  // Manual presses — settle each one independently and add to totals.
  // Per-press money distributes via the same loser-pays-stake / pot-
  // splits-with-deterministic-remainder rule auto-presses use, keyed
  // off the press's own side_a / side_b rp arrays (frozen at open
  // time, so 6-6-6 partner rotations are handled correctly).
  for (const press of manualPresses) {
    if (press.status !== "accepted") continue;
    if (press.side_a_rp_ids.length === 0 || press.side_b_rp_ids.length === 0) continue;

    // Compute per-hole match-play results from A's perspective using
    // each side's BEST gross score on that hole (best ball semantics —
    // works for 1v1 Nassau and 2v2 best-ball alike). Net-or-gross
    // matches whatever the parent game's mode is, but for v1 we use
    // gross to keep the press model uncoupled from per-game allowance.
    const sideASheets = press.side_a_rp_ids
      .map((rpId) => players.find((p) => p.id === rpId))
      .filter((p): p is RoundPlayer => !!p)
      .map((p) => buildPlayerSheet(p, scores, holes));
    const sideBSheets = press.side_b_rp_ids
      .map((rpId) => players.find((p) => p.id === rpId))
      .filter((p): p is RoundPlayer => !!p)
      .map((p) => buildPlayerSheet(p, scores, holes));

    const holeResults: HoleResult[] = holes.map((h) => {
      const aScores = sideASheets
        .map((s) => s.rows.find((r) => r.hole_number === h.hole_number)?.gross)
        .filter((v): v is number => v != null);
      const bScores = sideBSheets
        .map((s) => s.rows.find((r) => r.hole_number === h.hole_number)?.gross)
        .filter((v): v is number => v != null);
      const aComplete = aScores.length === sideASheets.length;
      const bComplete = bScores.length === sideBSheets.length;
      if (!aComplete || !bComplete) {
        return {
          hole_number: h.hole_number,
          a_won: false,
          b_won: false,
          push: false,
          incomplete: true
        };
      }
      const a = Math.min(...aScores);
      const b = Math.min(...bScores);
      return {
        hole_number: h.hole_number,
        a_won: a < b,
        b_won: b < a,
        push: a === b,
        incomplete: false
      };
    });

    const settled = settleManualPress(press, holeResults);
    if (settled.result_delta == null || settled.result_delta === 0) continue;

    // Filter press side arrays against the CURRENT player set before
    // distributing money. Press `side_a_rp_ids`/`side_b_rp_ids` are
    // frozen at press-open time. If a player was removed from the
    // round after the press opened, the frozen array still references
    // their rp_id — using it would write a delta to a non-existent
    // round_player, which then fails the settlements FK constraint
    // when the row is inserted. Bug caught in code review 2026-05-12.
    const validPlayerIds = new Set(players.map((p) => p.id));
    const aWon = settled.result_delta > 0;
    const winnersRaw = aWon ? press.side_a_rp_ids : press.side_b_rp_ids;
    const losersRaw = aWon ? press.side_b_rp_ids : press.side_a_rp_ids;
    const winners = winnersRaw.filter((id) => validPlayerIds.has(id));
    const losers = losersRaw.filter((id) => validPlayerIds.has(id));
    if (winners.length === 0 || losers.length === 0) {
      // The press references at least one removed player on a side
      // with no surviving members — the bet is effectively void.
      // Skip the press; the audit log still has the open/accept
      // records for posterity.
      continue;
    }

    const pot = press.stake_cents * losers.length;
    const m = new Map<string, number>();
    for (const id of losers) {
      const delta = -press.stake_cents;
      totals.set(id, (totals.get(id) ?? 0) + delta);
      m.set(id, delta);
    }
    const each = Math.floor(pot / winners.length);
    const remainder = pot - each * winners.length;
    const sortedWinners = [...winners].sort();
    sortedWinners.forEach((id, i) => {
      const delta = each + (i < remainder ? 1 : 0);
      totals.set(id, (totals.get(id) ?? 0) + delta);
      m.set(id, (m.get(id) ?? 0) + delta);
    });
    lines.push({
      game: settled.label,
      perPlayer: m
    });
  }

  // Junk side-bet settlement — additive on top of game settlements.
  // Pure-function engine in lib/games/junk.ts. The frozen amount on
  // each item is what settles; this code never re-prices history.
  if (junkItems.length > 0) {
    const junkAsEngine: JunkItem[] = junkItems.map((i) => ({
      id: i.id,
      player_id: i.round_player_id,
      hole_number: i.hole_number,
      category: i.category,
      custom_label: i.custom_label ?? undefined,
      amount_cents: i.amount_cents,
      created_at: i.created_at,
      note: i.note ?? undefined
    }));
    const junkResult = settleJunk(
      junkAsEngine,
      players.map((p) => ({ id: p.id }))
    );
    const m = new Map<string, number>();
    let anyNonZero = false;
    for (const [pid, v] of junkResult.deltaByPlayer) {
      // Compose totals only for non-zero deltas — but record EVERY
      // player's contribution to the per-line map so the "By game"
      // breakdown is honest about who participated, even at zero.
      // Prior version suppressed the entire junk line when all
      // deltas netted to zero (each of 4 players gets one $2 birdie
      // → net delta per player is 0 → line disappeared → commissioner
      // had no record junk was even played). Now we always push the
      // line as long as items > 0.
      m.set(pid, v);
      if (v !== 0) {
        totals.set(pid, (totals.get(pid) ?? 0) + v);
        anyNonZero = true;
      }
    }
    // Compose a one-line summary of category counts so the
    // settlement breakdown isn't just "Junk · $X" — it tells the
    // commissioner WHICH junk items moved the money. Capped at 5
    // distinct categories to keep the line scannable on mobile;
    // overflow becomes "+N more".
    const counts = new Map<string, number>();
    for (const it of junkAsEngine) {
      const key =
        it.category === "custom" && it.custom_label
          ? it.custom_label
          : categoryLabel(it.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const entries = [...counts.entries()];
    const shown = entries.slice(0, 5);
    const overflow = entries.length - shown.length;
    const countSummary = shown
      .map(([k, v]) => `${v} ${k.toLowerCase()}${v === 1 ? "" : "s"}`)
      .concat(overflow > 0 ? [`+${overflow} more`] : [])
      .join(", ");
    lines.push({
      game: `Junk · ${junkItems.length} item${
        junkItems.length === 1 ? "" : "s"
      } (${countSummary})${anyNonZero ? "" : " · no money moved"}`,
      perPlayer: m
    });
  }

  // Defensive zero-sum check before minimumFlow. minimumFlow doesn't
  // require zero-sum — it just pairs the most-negative with the
  // most-positive until one side empties. Non-zero-sum input would
  // leave residual non-zero balances unsettled (silent money leak).
  // Each individual engine is zero-sum on its own player view, so
  // the sum should always be zero — but a missed defensive check
  // anywhere in the composition above could leak a few cents.
  let totalsSum = 0;
  for (const v of totals.values()) totalsSum += v;
  if (totalsSum !== 0) {
    // Surface as a soft warning. We don't block finalize (the
    // commissioner might want to ship the settlement anyway) but
    // the audit trail captures the mismatch.
    // eslint-disable-next-line no-console
    console.warn(
      `[finalize] non-zero-sum totals: ${totalsSum} cents. Each engine should be zero-sum on its own — a residual indicates a player-set drift or engine bug.`
    );
  }

  const flows = minimumFlow(totals);
  const labelByPlayer = new Map(players.map((p) => [p.id, p.display_name]));
  // Venmo handle per round_player_id — used to build the "Pay in
  // Venmo helpers are imported from @/lib/profile-format so this
  // editor surface and the persistent SettlementSummary card share
  // the exact same regression-tested behavior.
  const venmoByPlayer = new Map<string, string>();
  for (const r of rps) {
    const cleaned = cleanHandle(r.players?.venmo_handle);
    if (cleaned) venmoByPlayer.set(r.id, cleaned);
  }
  const fmt = (c: number) => "$" + (Math.abs(c) / 100).toFixed(2);
  const noteForVenmo = venmoNoteForRound(courseName, roundDate);

  async function finalize() {
    setBusy(true);
    setErr(null);

    // Three steps; any failure must surface and abort. If we silently
    // continued past a failed step, the round could end up with stale
    // settlements (delete failed) or with status="live" but settlements
    // already written (round update failed).

    // 1. Wipe prior settlements for this round.
    {
      const { error } = await sb.from("settlements").delete().eq("round_id", roundId);
      if (error) {
        setBusy(false);
        setErr(`Couldn't clear prior settlements: ${error.message}`);
        return;
      }
    }

    // 2. Insert new settlements (if any flows).
    if (flows.length > 0) {
      const { error } = await sb.from("settlements").insert(
        flows.map((f) => ({
          round_id: roundId,
          from_round_player_id: f.from,
          to_round_player_id: f.to,
          amount_cents: f.amount_cents,
          breakdown: lines.map((l) => ({
            game: l.game,
            from: l.perPlayer.get(f.from) ?? 0,
            to: l.perPlayer.get(f.to) ?? 0
          }))
        }))
      );
      if (error) {
        setBusy(false);
        setErr(`Couldn't save settlement: ${error.message}`);
        return;
      }
    }

    // 3. Flip round status to "finalized".
    {
      const { error } = await sb
        .from("rounds")
        .update({ status: "finalized", finalized_at: new Date().toISOString() })
        .eq("id", roundId);
      if (error) {
        setBusy(false);
        setErr(`Couldn't lock the round: ${error.message}`);
        return;
      }
    }

    setBusy(false);
    router.push(`/rounds/${roundId}`);
  }

  const recap = useMemo(
    () => generateRecap({ players, scores, holes, games: games as RoundGame[] }),
    [players, scores, holes, games]
  );

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Breadcrumb is now provided by the parent page (RoundBreadcrumb).
          This view focuses on the settlement work itself. */}
      <header>
        {/* Audit P2 #28: "Settle up" reads more naturally to a
            member-member group than the technical "Finalize round". */}
        <p className="h-eyebrow">Settlement</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Settle up</h1>
      </header>

      {pendingPressCount > 0 && (
        <div className="card p-4 border border-amber-400/40 bg-amber-500/5 space-y-1">
          <p className="h-eyebrow text-amber-300">
            {pendingPressCount} press{pendingPressCount === 1 ? "" : "es"} still pending
          </p>
          <p className="text-sm text-cream-50">
            Finalizing now drops {pendingPressCount === 1 ? "that press" : "those presses"} —
            {pendingPressCount === 1 ? " it" : " they"} won&apos;t settle.
          </p>
          <p className="text-[11px] text-cream-100/65 leading-snug">
            Go back to the round page and either get them accepted, or withdraw
            them so the opener knows. Once finalized, pending presses can&apos;t be
            recovered without unfinalizing.
          </p>
          <Link
            href={`/rounds/${roundId}`}
            className="btn-ghost text-xs mt-1 inline-block"
          >
            ← Back to round
          </Link>
        </div>
      )}

      <SmackTalk moments={recap} />

      <div className="card p-5">
        <h2 className="font-serif text-xl text-cream-50 mb-3">By game</h2>
        <ul className="space-y-4 text-sm">
          {lines.map((l, i) => (
            <li key={i}>
              <div className="font-medium text-cream-50 break-words">{l.game}</div>
              <ul className="pl-4 mt-1 space-y-0.5">
                {[...l.perPlayer.entries()].sort((a, b) => b[1] - a[1]).map(([pid, v]) => (
                  <li key={pid} className="flex justify-between">
                    <span className="text-cream-100/80">{labelByPlayer.get(pid)}</span>
                    <span className={`tabular-nums ${v > 0 ? "text-emerald-300" : v < 0 ? "text-red-300" : "text-cream-100/55"}`}>{(v >= 0 ? "+" : "−") + fmt(v)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-xl text-cream-50">Who pays whom</h2>
          <span className="text-[11px] text-cream-100/55">
            Computed by netting every game and finding the fewest transfers.
          </span>
        </div>
        {flows.length === 0 ? (
          <p className="text-sm text-cream-100/55">Nothing owed — everyone broke even.</p>
        ) : (
          <ul className="text-sm space-y-3">
            {flows.map((f, i) => {
              // Build the explanation. Per Patrick 2026-05-12 trust-math
              // framing: both the payer AND the recipient need to see how
              // each game contributed to their own side — taking the
              // math on faith is the failure mode this app exists to
              // prevent.
              const fromDeltas = lines
                .map((l) => ({ game: l.game, cents: l.perPlayer.get(f.from) ?? 0 }))
                .filter((x) => x.cents !== 0);
              const toDeltas = lines
                .map((l) => ({ game: l.game, cents: l.perPlayer.get(f.to) ?? 0 }))
                .filter((x) => x.cents !== 0);
              const fromTotal = fromDeltas.reduce((s, x) => s + x.cents, 0);
              const toTotal = toDeltas.reduce((s, x) => s + x.cents, 0);
              const toHandle = venmoByPlayer.get(f.to);
              const toName = labelByPlayer.get(f.to);
              const fromName = labelByPlayer.get(f.from);
              return (
                <li key={i} className="border-t border-cream-100/8 first:border-t-0 first:pt-0 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-medium text-cream-50">{labelByPlayer.get(f.from)}</span>
                      <span className="text-cream-100/40 mx-2">→</span>
                      <span className="font-medium text-cream-50">{toName}</span>
                    </div>
                    <span className="tabular-nums font-serif text-lg text-cream-50">{fmt(f.amount_cents)}</span>
                  </div>
                  {toHandle ? (
                    <div className="mt-1.5">
                      <a
                        // Universal Venmo link — iOS hands off to the
                        // app via Universal Links (prefills recipient,
                        // amount, note); desktop opens venmo.com/{handle}
                        // with the same params. Either way, the payer
                        // taps once.
                        href={venmoPayUrl(
                          toHandle,
                          f.amount_cents / 100,
                          noteForVenmo
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3D95CE] hover:text-[#2D7AB0] underline underline-offset-2"
                      >
                        Pay {toName} {fmt(f.amount_cents)} in Venmo →
                      </a>
                      <span className="ml-2 text-[10px] text-cream-100/45">
                        @{toHandle}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-cream-100/45">
                      No Venmo on file for {toName} — settle in person, or add
                      a handle on their profile.
                    </p>
                  )}
                  {/* Two-way breakdown: both payer and recipient see how
                      each game contributed to their own side. */}
                  {(fromDeltas.length > 0 || toDeltas.length > 0) && (
                    <details className="mt-1.5 text-[11px] text-cream-100/65 leading-snug">
                      <summary className="cursor-pointer text-cream-100/55 hover:text-cream-100">
                        How this was calculated
                      </summary>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {fromDeltas.length > 0 && (
                          <div className="pl-3 border-l border-red-400/30">
                            <p className="text-[10px] uppercase tracking-wider text-cream-100/55 mb-1">
                              {fromName}&apos;s side
                            </p>
                            <ul className="space-y-0.5">
                              {fromDeltas.map((x, j) => (
                                <li key={j} className="flex justify-between gap-2 tabular-nums">
                                  <span className="truncate">{x.game}</span>
                                  <span className={x.cents > 0 ? "text-emerald-300" : "text-red-300"}>
                                    {x.cents >= 0 ? "+" : "−"}{fmt(x.cents)}
                                  </span>
                                </li>
                              ))}
                              <li className="flex justify-between gap-2 mt-1 pt-1 border-t border-cream-100/8 tabular-nums font-medium">
                                <span className="text-cream-100/85">Net</span>
                                <span className={fromTotal >= 0 ? "text-emerald-300" : "text-red-300"}>
                                  {fromTotal >= 0 ? "+" : "−"}{fmt(fromTotal)}
                                </span>
                              </li>
                            </ul>
                          </div>
                        )}
                        {toDeltas.length > 0 && (
                          <div className="pl-3 border-l border-emerald-400/30">
                            <p className="text-[10px] uppercase tracking-wider text-cream-100/55 mb-1">
                              {toName}&apos;s side
                            </p>
                            <ul className="space-y-0.5">
                              {toDeltas.map((x, j) => (
                                <li key={j} className="flex justify-between gap-2 tabular-nums">
                                  <span className="truncate">{x.game}</span>
                                  <span className={x.cents > 0 ? "text-emerald-300" : "text-red-300"}>
                                    {x.cents >= 0 ? "+" : "−"}{fmt(x.cents)}
                                  </span>
                                </li>
                              ))}
                              <li className="flex justify-between gap-2 mt-1 pt-1 border-t border-cream-100/8 tabular-nums font-medium">
                                <span className="text-cream-100/85">Net</span>
                                <span className={toTotal >= 0 ? "text-emerald-300" : "text-red-300"}>
                                  {toTotal >= 0 ? "+" : "−"}{fmt(toTotal)}
                                </span>
                              </li>
                            </ul>
                          </div>
                        )}
                      </div>
                      {Math.abs(fromTotal) !== f.amount_cents && (
                        <p className="text-[10px] text-cream-100/55 mt-2">
                          This transfer is part of a chain — {fromName} owes
                          a total of {fmt(Math.abs(fromTotal))} but it&apos;s
                          split across multiple recipients to keep the number
                          of Venmo transfers low.
                        </p>
                      )}
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {gameErrors.length > 0 && (
        <div className="card p-3 border border-red-400/40 bg-red-500/10 text-xs space-y-1">
          <p className="font-medium text-red-200">
            {gameErrors.length} game{gameErrors.length === 1 ? "" : "s"}{" "}
            couldn&apos;t settle:
          </p>
          <ul className="text-red-100/85 space-y-0.5">
            {gameErrors.map((m, i) => (
              <li key={i} className="break-words">
                · {m}
              </li>
            ))}
          </ul>
          <p className="text-red-100/65 text-[11px] leading-snug">
            The settlement below excludes these games. Fix the underlying
            issue (usually a missing score, or a player added/removed
            after some scoring was written) and reload.
          </p>
        </div>
      )}
      {err && <p className="text-red-300 text-sm">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={finalize}>
          {busy ? "Finalizing…" : "Finalize round"}
        </button>
        {spectatorToken && (
          <ShareSheet
            title="Round results"
            // Public spectator leaderboard requires the token —
            // without it the page redirects anonymous viewers home.
            // Include the token in BOTH the shared URL and the
            // generated image route so the OG image renders for
            // unauthenticated previews too.
            url={
              typeof window !== "undefined"
                ? `${window.location.origin}/rounds/${roundId}/leaderboard?token=${encodeURIComponent(spectatorToken)}`
                : ""
            }
            imageUrl={`/api/share/round/${roundId}/image?token=${encodeURIComponent(spectatorToken)}`}
            imageFilename={`cruz-golf-${roundId}.png`}
            triggerLabel="Share"
            triggerClassName="btn-secondary"
          />
        )}
      </div>
      <p className="text-[11px] text-cream-100/55">
        After finalizing, the commissioner can still unlock the round to fix
        scores. Players can&apos;t edit on a finalized round until it&apos;s
        unlocked.
      </p>
    </div>
  );
}
