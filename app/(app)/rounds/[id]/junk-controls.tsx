"use client";
/**
 * Junk side-bet controls — entry surface + live totals + edit/remove.
 *
 * Design principle (per Patrick):
 *   "Tap the extra things that happened on the hole."
 * Not accounting software. The mobile entry path is two taps:
 *   1. Pick the player chip.
 *   2. Pick the category chip → recorded with server-authoritative
 *      pricing, animates into the live items list.
 *
 * Rendered on /rounds/[id] ABOVE the leaderboard when:
 *   - junk is enabled on the round (config row exists), AND
 *   - the round is live or pending_finalization (no record on finalized).
 *
 * Reads/writes via SECURITY DEFINER RPCs in migration 0041:
 *   - fn_record_junk(round_id, round_player_id, hole, category, …)
 *   - fn_edit_junk(item_id, …)  [not yet wired to UI — admin path]
 *   - fn_remove_junk(item_id, reason) [commissioner only]
 *
 * The component is intentionally compact: ~1 screen on mobile with
 * everything reachable. The "live totals" footer is the at-a-glance
 * answer to "am I up or down on junk?".
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  buildLiveJunkTotals,
  categoryDescription,
  categoryLabel,
  type JunkCategory,
  type JunkItem
} from "@/lib/games/junk";

export type JunkRP = {
  id: string;
  display_name: string;
};

export type JunkConfigRow = {
  active_categories: JunkCategory[];
  mode: "flat" | "escalating";
  flat_amount_cents: number | null;
  base_amount_cents: number | null;
  escalation_step_cents: number | null;
  escalation_scope:
    | "per_round"
    | "per_category"
    | "per_player_per_category"
    | null;
};

export type JunkItemRow = {
  id: string;
  round_player_id: string;
  hole_number: number;
  category: JunkCategory;
  custom_label: string | null;
  amount_cents: number;
  created_at: string;
  created_by: string | null;
  note: string | null;
};

const fmt$ = (cents: number) =>
  (cents >= 0 ? "+$" : "−$") + (Math.abs(cents) / 100).toFixed(2);
const fmtFlat$ = (cents: number) => "$" + (cents / 100).toFixed(2);

export function JunkControls({
  roundId,
  totalHoles,
  defaultHole,
  rps,
  config,
  initialItems,
  isCommissioner
}: {
  roundId: string;
  totalHoles: number;
  /** Best-guess current hole from the round's scoring state — used
   *  to pre-select the hole picker. Falls back to 1. */
  defaultHole: number;
  rps: JunkRP[];
  config: JunkConfigRow;
  initialItems: JunkItemRow[];
  isCommissioner: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [items, setItems] = useState<JunkItemRow[]>(initialItems);
  const [hole, setHole] = useState<number>(Math.min(Math.max(1, defaultHole), totalHoles));
  const [selectedRp, setSelectedRp] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // category currently being saved
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Realtime: any junk recorded by another player should appear here
  // within ~1 socket roundtrip.
  //
  // Channel topic includes a per-instance useId() suffix so two tabs
  // open to the same round (or React Strict Mode's double-mount in
  // dev) don't collide on the same topic. Supabase Realtime silently
  // no-ops the second subscribe when topics collide, and the user
  // gets "junk doesn't sync" with no error.
  const realtimeChannelId = useId();
  useEffect(() => {
    const channel = sb
      .channel(`junk-${roundId}-${realtimeChannelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "round_junk_items",
          filter: `round_id=eq.${roundId}`
        },
        () => {
          // Cheap refetch — junk lists are small.
          (async () => {
            const { data } = await sb
              .from("round_junk_items")
              .select(
                "id, round_player_id, hole_number, category, custom_label, amount_cents, created_at, created_by, note, deleted_at"
              )
              .eq("round_id", roundId)
              .is("deleted_at", null)
              .order("created_at", { ascending: true });
            if (data) setItems(data as any);
          })();
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [roundId, sb, realtimeChannelId]);

  // Compute the live-amount preview for the currently-selected (player,
  // category) tuple. Same math as the server's fn_compute_junk_amount —
  // mirrors lib/games/junk.ts:computeJunkAmount.
  function previewAmount(category: JunkCategory): number {
    if (config.mode === "flat") {
      return config.flat_amount_cents ?? 0;
    }
    const base = config.base_amount_cents ?? 0;
    const step = config.escalation_step_cents ?? 0;
    let priorCount = 0;
    const scope = config.escalation_scope ?? "per_round";
    if (scope === "per_round") {
      priorCount = items.length;
    } else if (scope === "per_category") {
      priorCount = items.filter((i) => i.category === category).length;
    } else if (scope === "per_player_per_category") {
      priorCount = items.filter(
        (i) => i.category === category && i.round_player_id === selectedRp
      ).length;
    }
    return base + priorCount * step;
  }

  const nameById = useMemo(
    () => new Map(rps.map((p) => [p.id, p.display_name])),
    [rps]
  );

  // Build the JunkItem[] shape settleJunk wants so we can show totals.
  const junkItems = useMemo<JunkItem[]>(
    () =>
      items.map((i) => ({
        id: i.id,
        player_id: i.round_player_id,
        hole_number: i.hole_number,
        category: i.category,
        custom_label: i.custom_label ?? undefined,
        amount_cents: i.amount_cents,
        created_at: i.created_at,
        note: i.note ?? undefined
      })),
    [items]
  );
  const live = useMemo(
    () => buildLiveJunkTotals(junkItems, rps.map((p) => ({ id: p.id }))),
    [junkItems, rps]
  );

  async function recordJunk(category: JunkCategory, customLabel?: string) {
    if (!selectedRp) {
      setErr("Pick the player who got it first.");
      return;
    }
    setPending(category);
    setErr(null);
    const { error } = await sb.rpc("fn_record_junk", {
      p_round_id: roundId,
      p_round_player_id: selectedRp,
      p_hole_number: hole,
      p_category: category,
      p_custom_label: customLabel ?? null,
      p_note: null
    });
    setPending(null);
    if (error) {
      setErr(error.message);
      return;
    }
    const name = nameById.get(selectedRp) ?? "Player";
    setToast(`${name} · ${categoryLabel(category)} · hole ${hole}`);
    setTimeout(() => setToast(null), 2200);
    router.refresh();
  }

  async function removeItem(item: JunkItemRow) {
    const reason = prompt(
      `Remove this junk item?\n\n${nameById.get(item.round_player_id) ?? "Player"} · ${categoryLabel(item.category)} · hole ${item.hole_number} · ${fmtFlat$(item.amount_cents)}\n\nReason (required):`
    );
    if (!reason || reason.trim().length === 0) return;
    const { error } = await sb.rpc("fn_remove_junk", {
      p_item_id: item.id,
      p_reason: reason.trim()
    });
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const totalPot = live.total_pot_cents;
  const sortedTotals = [...rps].sort(
    (a, b) =>
      (live.byPlayer.get(b.id)?.net_cents ?? 0) -
      (live.byPlayer.get(a.id)?.net_cents ?? 0)
  );

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Junk</p>
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Tap the extra things that happened on the hole.{" "}
            {config.mode === "flat" ? (
              <>Flat {fmtFlat$(config.flat_amount_cents ?? 0)} per item.</>
            ) : (
              <>
                {fmtFlat$(config.base_amount_cents ?? 0)} base ·{" "}
                {fmtFlat$(config.escalation_step_cents ?? 0)} escalating ·{" "}
                {config.escalation_scope === "per_category"
                  ? "per category"
                  : config.escalation_scope === "per_player_per_category"
                  ? "per player + category"
                  : "per round"}
              </>
            )}
          </p>
        </div>
        <span className="text-[11px] text-cream-100/55 tabular-nums">
          {items.length} item{items.length === 1 ? "" : "s"} · pot moved {fmtFlat$(totalPot)}
        </span>
      </header>

      {/* Hole picker — defaults to current hole but commissioner / scorer
          can shift back for "I forgot to log Mit's birdie on 4". */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="text-cream-100/65">Hole:</label>
        <select
          className="input text-sm px-2 py-1 w-auto"
          value={hole}
          onChange={(e) => setHole(parseInt(e.target.value, 10))}
        >
          {Array.from({ length: totalHoles }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      {/* Player chip row */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
          Who got it?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {rps.map((p) => {
            const active = selectedRp === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`pill text-xs px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85 hover:bg-brand-900"
                }`}
                onClick={() => setSelectedRp(active ? null : p.id)}
                aria-pressed={active}
              >
                {active ? "✓ " : ""}
                {p.display_name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category chip row — disabled when no player selected so a stray
          tap doesn't error. Each chip records on tap (no "Confirm" gate
          — Patrick's "tap the extras" UX). */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
          What?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {config.active_categories.map((cat) => {
            const amt = previewAmount(cat);
            const isPending = pending === cat;
            return (
              <button
                key={cat}
                type="button"
                disabled={!selectedRp || pending !== null}
                title={categoryDescription(cat)}
                className={`pill text-xs px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                  !selectedRp
                    ? "bg-brand-900/30 text-cream-100/30 cursor-not-allowed"
                    : isPending
                    ? "bg-gold-500/40 text-cream-50"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85 hover:bg-gold-500/15 hover:border-gold-500/30"
                }`}
                onClick={() => recordJunk(cat)}
              >
                <span>{categoryLabel(cat)}</span>
                <span className="text-gold-400 tabular-nums text-[10px]">
                  {fmtFlat$(amt)}
                </span>
              </button>
            );
          })}
        </div>
        {!selectedRp && (
          <p className="text-[10px] text-cream-100/45">
            Select a player above first.
          </p>
        )}
      </div>

      {toast && (
        <p className="text-[11px] text-emerald-300">
          Recorded: <span className="font-medium">{toast}</span>
        </p>
      )}
      {err && (
        <p className="text-[11px] text-red-300 break-words">{err}</p>
      )}

      {/* Live totals strip — sorted high-to-low so the leader is first. */}
      {items.length > 0 && (
        <div className="border-t border-cream-100/10 pt-2.5 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
            Live totals
          </p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {sortedTotals.map((p) => {
              const slot = live.byPlayer.get(p.id);
              const net = slot?.net_cents ?? 0;
              return (
                <li
                  key={p.id}
                  className="rounded-full bg-brand-900/30 border border-cream-100/10 px-3 py-1 tabular-nums"
                >
                  <span className="text-cream-50">{p.display_name}</span>{" "}
                  <span
                    className={
                      net > 0
                        ? "text-emerald-300 font-medium"
                        : net < 0
                        ? "text-red-300 font-medium"
                        : "text-cream-100/55"
                    }
                  >
                    {fmt$(net)}
                  </span>
                  {slot && slot.items_won > 0 && (
                    <span className="text-cream-100/55 ml-1">
                      · {slot.items_won}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Item log — collapsible, newest first. Commissioner gets
              remove buttons; everyone else sees read-only entries. */}
          <details className="text-xs">
            <summary className="cursor-pointer text-cream-100/65 hover:text-cream-100/85 select-none">
              All items ({items.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {[...items]
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime()
                )
                .map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-brand-900/30 px-3 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-cream-50">
                        {nameById.get(it.round_player_id) ?? "Player"}
                      </span>
                      <span className="text-cream-100/65">
                        {" "}
                        ·{" "}
                        {it.category === "custom" && it.custom_label
                          ? it.custom_label
                          : categoryLabel(it.category)}
                      </span>
                      <span className="text-cream-100/55">
                        {" "}
                        · hole {it.hole_number}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-gold-400 tabular-nums">
                        {fmtFlat$(it.amount_cents)}
                      </span>
                      {isCommissioner && (
                        <button
                          type="button"
                          className="text-cream-100/45 hover:text-red-300"
                          onClick={() => removeItem(it)}
                          aria-label="Remove this junk item"
                          title="Remove (commissioner)"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
