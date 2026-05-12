/**
 * Read-only settlement card for a finalized round, surfaced ON the round
 * detail page so a user looking back at a Saturday round doesn't have to
 * navigate to /finalize to see who paid whom.
 *
 * Per Patrick's product framing (2026-05-12): the trust math layer is the
 * long-term moat. The numbers must persist where the user actually looks.
 * Both the payer AND the recipient need to be able to verify their own
 * total without taking the math on faith.
 *
 * Pure server component — reads pre-computed rows from the `settlements`
 * table (written by the finalize flow). No engine work here, no re-derivation
 * of game settlements — that lives in the editor at /finalize and stays
 * the single source of truth.
 */
import Link from "next/link";
import { ShareSheet } from "./ShareSheet";

export type SettlementFlow = {
  from_round_player_id: string;
  to_round_player_id: string;
  amount_cents: number;
  /** JSONB column from `settlements.breakdown`. Shape (per finalize-view):
   *  Array<{ game: string; from: number; to: number }>
   *  Each entry shows what that game contributed to BOTH sides of the
   *  flow — the two-way transparency Patrick called out as essential. */
  breakdown: any;
};

export function SettlementSummary({
  roundId,
  flows,
  rps,
  finalizedAt,
  viewerRpId,
  isCommissioner,
  courseName,
  roundDate,
  spectatorToken = null
}: {
  roundId: string;
  flows: SettlementFlow[];
  rps: Array<{
    id: string;
    /** Global player_id (not round_player_id). Used to build the
     *  /players/{id}/stats link when the viewer is owed money but
     *  hasn't put a Venmo handle on their own profile yet. */
    player_id: string;
    display_name: string;
    venmo_handle: string | null;
  }>;
  finalizedAt: string | null;
  /** The round_player_id of the signed-in viewer, when they're a player
   *  in this round. Used to highlight rows the viewer is on either side
   *  of and to surface the right Venmo deep-link. */
  viewerRpId: string | null;
  isCommissioner: boolean;
  courseName: string | null;
  roundDate: string | null;
  /** Spectator-link token. When set the Share button surfaces a public
   *  leaderboard URL anyone in the group chat can open. */
  spectatorToken?: string | null;
}) {
  const labelByPlayer = new Map(rps.map((p) => [p.id, p.display_name]));
  const playerIdByRp = new Map(rps.map((p) => [p.id, p.player_id]));
  const venmoByPlayer = new Map<string, string>();
  for (const r of rps) {
    if (!r.venmo_handle) continue;
    const cleaned = r.venmo_handle.replace(/^@/, "").trim();
    if (cleaned) venmoByPlayer.set(r.id, cleaned);
  }

  // Viewer's own Venmo-on-file state. When the viewer is owed money on
  // any flow AND hasn't put a Venmo handle on their profile, show one
  // calm nudge to fix it — otherwise the payer sees "No Venmo on file
  // for [you]" and they have to coordinate offline. Trust-math /
  // payment-clarity move per Patrick 2026-05-12.
  const viewerIsRecipient =
    viewerRpId != null &&
    flows.some((f) => f.to_round_player_id === viewerRpId);
  const viewerHasVenmo = viewerRpId != null && venmoByPlayer.has(viewerRpId);
  const viewerPlayerId =
    viewerRpId != null ? playerIdByRp.get(viewerRpId) ?? null : null;
  const showViewerVenmoNudge =
    viewerIsRecipient && !viewerHasVenmo && viewerPlayerId != null;

  const fmt = (c: number) => "$" + (Math.abs(c) / 100).toFixed(2);

  // Compose Venmo note: "Cruz Golf · JGCC · May 12". Locale-fixed so the
  // text is stable across device locales.
  const noteForVenmo = (() => {
    const parts: string[] = ["Cruz Golf"];
    if (courseName) parts.push(courseName);
    if (roundDate) {
      const d = new Date(roundDate + "T00:00:00");
      if (!isNaN(d.getTime())) {
        parts.push(
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        );
      }
    }
    return parts.join(" · ");
  })();

  function venmoPayUrl(handle: string, dollars: number, note: string) {
    const params = new URLSearchParams({
      txn: "pay",
      amount: dollars.toFixed(2),
      note
    });
    return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
  }

  const niceFinalizedAt = (() => {
    if (!finalizedAt) return null;
    const d = new Date(finalizedAt);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  })();

  return (
    <section className="card p-5 space-y-3">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Settlement</p>
          <h2 className="font-serif text-xl text-cream-50 mt-1">
            {flows.length === 0 ? "Even up — nothing owed" : "Who pays whom"}
          </h2>
        </div>
        {niceFinalizedAt && (
          <span className="text-[11px] text-cream-100/55">
            Settled {niceFinalizedAt}
          </span>
        )}
      </header>

      {showViewerVenmoNudge && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-xs leading-snug">
          <p className="text-cream-50">
            You&apos;re owed money this round — but you haven&apos;t put a
            Venmo handle on your profile yet.
          </p>
          <Link
            href={`/players/${viewerPlayerId}/stats`}
            className="inline-flex items-center gap-1 mt-1 text-gold-400 hover:underline"
          >
            Set your Venmo →
          </Link>
        </div>
      )}

      {flows.length === 0 ? (
        <p className="text-sm text-cream-100/65">
          Every game netted to zero — no transfers needed.
        </p>
      ) : (
        <ul className="text-sm space-y-3">
          {flows.map((f, i) => {
            const fromName = labelByPlayer.get(f.from_round_player_id);
            const toName = labelByPlayer.get(f.to_round_player_id);
            const toHandle = venmoByPlayer.get(f.to_round_player_id);
            // Two-way transparency: build BOTH sides' per-game contributions
            // from the breakdown JSONB. Format: [{game, from, to}, ...].
            // Filter to non-zero so the panel stays focused on what actually
            // moved.
            const items: Array<{ game: string; from: number; to: number }> =
              Array.isArray(f.breakdown) ? f.breakdown : [];
            const fromDeltas = items
              .filter((x) => x.from !== 0)
              .map((x) => ({ game: x.game, cents: x.from }));
            const toDeltas = items
              .filter((x) => x.to !== 0)
              .map((x) => ({ game: x.game, cents: x.to }));
            const fromTotal = fromDeltas.reduce((s, x) => s + x.cents, 0);
            const toTotal = toDeltas.reduce((s, x) => s + x.cents, 0);
            const viewerIsPayer = viewerRpId === f.from_round_player_id;
            const viewerIsRecipient = viewerRpId === f.to_round_player_id;
            const highlight = viewerIsPayer || viewerIsRecipient;

            return (
              <li
                key={i}
                className={`border-t border-cream-100/8 first:border-t-0 first:pt-0 pt-3 ${
                  highlight ? "" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-cream-50">{fromName}</span>
                    <span className="text-cream-100/40 mx-2">→</span>
                    <span className="font-medium text-cream-50">{toName}</span>
                    {viewerIsPayer && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-gold-400">
                        You pay
                      </span>
                    )}
                    {viewerIsRecipient && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-300">
                        You receive
                      </span>
                    )}
                  </div>
                  <span className="tabular-nums font-serif text-lg text-cream-50">
                    {fmt(f.amount_cents)}
                  </span>
                </div>
                {toHandle && viewerIsPayer ? (
                  <div className="mt-1.5">
                    <a
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
                  </div>
                ) : toHandle ? (
                  <p className="mt-1 text-[11px] text-cream-100/45">
                    @{toHandle} · Venmo
                  </p>
                ) : null}
                {(fromDeltas.length > 0 || toDeltas.length > 0) && (
                  <details className="mt-1.5 text-[11px] text-cream-100/70 leading-snug">
                    <summary className="cursor-pointer text-cream-100/55 hover:text-cream-100">
                      How this was calculated
                    </summary>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Two-way transparency: both payer AND recipient
                          see how each game contributed to their own side.
                          Patrick's product framing 2026-05-12 — the math
                          shouldn't have to be taken on faith. */}
                      {fromDeltas.length > 0 && (
                        <div className="pl-3 border-l border-red-400/30">
                          <p className="text-[10px] uppercase tracking-wider text-cream-100/55 mb-1">
                            {fromName}&apos;s side
                          </p>
                          <ul className="space-y-0.5">
                            {fromDeltas.map((x, j) => (
                              <li
                                key={j}
                                className="flex justify-between gap-2 tabular-nums"
                              >
                                <span className="truncate">{x.game}</span>
                                <span
                                  className={
                                    x.cents > 0
                                      ? "text-emerald-300"
                                      : "text-red-300"
                                  }
                                >
                                  {x.cents >= 0 ? "+" : "−"}
                                  {fmt(x.cents)}
                                </span>
                              </li>
                            ))}
                            <li className="flex justify-between gap-2 mt-1 pt-1 border-t border-cream-100/8 tabular-nums font-medium">
                              <span className="text-cream-100/85">Net</span>
                              <span
                                className={
                                  fromTotal >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300"
                                }
                              >
                                {fromTotal >= 0 ? "+" : "−"}
                                {fmt(fromTotal)}
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
                              <li
                                key={j}
                                className="flex justify-between gap-2 tabular-nums"
                              >
                                <span className="truncate">{x.game}</span>
                                <span
                                  className={
                                    x.cents > 0
                                      ? "text-emerald-300"
                                      : "text-red-300"
                                  }
                                >
                                  {x.cents >= 0 ? "+" : "−"}
                                  {fmt(x.cents)}
                                </span>
                              </li>
                            ))}
                            <li className="flex justify-between gap-2 mt-1 pt-1 border-t border-cream-100/8 tabular-nums font-medium">
                              <span className="text-cream-100/85">Net</span>
                              <span
                                className={
                                  toTotal >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300"
                                }
                              >
                                {toTotal >= 0 ? "+" : "−"}
                                {fmt(toTotal)}
                              </span>
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>
                    {Math.abs(fromTotal) !== f.amount_cents && (
                      <p className="text-[10px] text-cream-100/55 mt-2">
                        This transfer is part of a chain — {fromName} owes a
                        total of {fmt(Math.abs(fromTotal))} but it&apos;s
                        split across multiple recipients to keep the number of
                        Venmo transfers low.
                      </p>
                    )}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link
          href={`/rounds/${roundId}/finalize`}
          className="text-[11px] text-cream-100/55 hover:text-cream-100 underline underline-offset-2"
        >
          View on settlement editor →
        </Link>
        {spectatorToken && (
          <ShareSheet
            title="Round results"
            // Same token-included URL pattern as the finalize view.
            // Tested: anonymous viewers reach the public leaderboard
            // when the token is present; redirected to "/" without it.
            url={
              typeof window !== "undefined"
                ? `${window.location.origin}/rounds/${roundId}/leaderboard?token=${encodeURIComponent(spectatorToken)}`
                : ""
            }
            imageUrl={`/api/share/round/${roundId}/image?token=${encodeURIComponent(spectatorToken)}`}
            imageFilename={`cruz-golf-${roundId}.png`}
            triggerLabel="Share"
            triggerClassName="btn-secondary text-xs"
          />
        )}
      </div>
    </section>
  );
}
