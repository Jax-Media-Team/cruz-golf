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
import { friendlyAuthError } from "@/lib/auth-errors";
import {
  buildLiveJunkTotals,
  categoryDescription,
  categoryLabel,
  type JunkCategory,
  type JunkItem
} from "@/lib/games/junk";
import { resolveActivePartners } from "@/lib/games/partners";

export type JunkRP = {
  id: string;
  display_name: string;
  /** team_id from round_players. Used by partner-resolution to group
   *  players into team-junk recipient sets when a partner game is
   *  enabled (best ball, scramble, aggregate, team_match). For 6-6-6
   *  the partner is derived from the game's rotation config instead.
   *  Optional — solo formats don't need it. */
  team_id?: string | null;
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
  /** Group-specific labels managed by the commissioner in the
   *  games-editor. Rendered as dashed-border chips alongside the
   *  built-in active_categories. JSONB column on junk_config —
   *  may be null on older rounds. */
  custom_categories?: Array<{ key: string; label: string }> | null;
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
  /** TEAM JUNK (Patrick 2026-05-13 #4): the full recipient set for
   *  team-awarded items. Populated by the JOIN to
   *  round_junk_item_recipients in the server fetch. May be null /
   *  empty for legacy items recorded before migration 0048 — those
   *  settle as solo via the engine's backwards-compat fallback. */
  recipient_ids?: string[] | null;
  is_team_award?: boolean | null;
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
  isCommissioner,
  games = []
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
  /** Active games on the round. Used to detect partner formats
   *  (6-6-6 / best ball / scramble / team_match) and auto-assign
   *  team-junk recipients. Empty array → solo-only mode (legacy
   *  behavior). Patrick 2026-05-13 #4. */
  games?: Array<{
    id: string;
    game_type: string;
    name: string;
    config?: any;
  }>;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [items, setItems] = useState<JunkItemRow[]>(initialItems);
  const [hole, setHole] = useState<number>(Math.min(Math.max(1, defaultHole), totalHoles));
  const [selectedRp, setSelectedRp] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // category currently being saved
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Custom-category entry. When the user taps "+ Other", they type
  // a one-off label (e.g. "Woodie", "Wilson special") + tap Record.
  // The RPC accepts category="custom" unconditionally — it doesn't
  // need to be in active_categories — but DOES require a non-empty
  // label.
  const [customMode, setCustomMode] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  // Track whether the user has manually overridden the hole picker.
  // After a manual change we stop auto-syncing from defaultHole — the
  // scorer might be backfilling junk on an earlier hole and we
  // shouldn't snap them forward when router.refresh() lands the next
  // score. Resets to false when the round advances past the
  // currently-picked hole (the scorer obviously moved on).
  const [holeManuallySet, setHoleManuallySet] = useState(false);
  useEffect(() => {
    // Sync the hole picker forward when defaultHole shifts (after a
    // score lands and the round-page re-renders with a new
    // "current hole" estimate). Skip if the user explicitly picked
    // a hole AND it's still ahead of where play is.
    const clamped = Math.min(Math.max(1, defaultHole), totalHoles);
    if (!holeManuallySet) {
      setHole(clamped);
    } else if (clamped > hole) {
      // Play passed the manual override — drop the override.
      setHole(clamped);
      setHoleManuallySet(false);
    }
    // Intentionally exclude hole/holeManuallySet from deps — we only
    // want this to fire when the prop shifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultHole, totalHoles]);

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
          // Cheap refetch — junk lists are small. Includes the recipients
          // embed so realtime updates surface team-junk awards. The
          // realtime channel listens on round_junk_items only (not the
          // recipients table) — that's fine because every team-record
          // pass inserts the items row + recipients in the same RPC
          // transaction, so by the time we refetch the recipients are
          // already there.
          (async () => {
            const { data } = await sb
              .from("round_junk_items")
              .select(
                "id, round_player_id, hole_number, category, custom_label, amount_cents, created_at, created_by, note, deleted_at, is_team_award, round_junk_item_recipients(round_player_id)"
              )
              .eq("round_id", roundId)
              .is("deleted_at", null)
              .order("created_at", { ascending: true });
            if (data) {
              setItems(
                data.map((i: any) => ({
                  ...i,
                  recipient_ids: Array.isArray(i.round_junk_item_recipients)
                    ? i.round_junk_item_recipients
                        .map((r: any) => r?.round_player_id)
                        .filter((x: any) => typeof x === "string")
                    : null
                })) as any
              );
            }
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
  // recipient_ids flows through so team-junk items split the pot
  // correctly in the live totals (Patrick 2026-05-13 #4).
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
        note: i.note ?? undefined,
        recipient_ids: i.recipient_ids ?? undefined,
        is_team_award: i.is_team_award ?? undefined
      })),
    [items]
  );
  const live = useMemo(
    () => buildLiveJunkTotals(junkItems, rps.map((p) => ({ id: p.id }))),
    [junkItems, rps]
  );

  // ===========================================================
  // TEAM JUNK auto-resolution (Patrick 2026-05-13 #4)
  // ===========================================================
  // Re-resolve partners every time the hole changes (6-6-6 rotates
  // partners by segment, so hole 1 vs hole 7 may pair the selected
  // player with someone different). The descriptor is null on
  // solo-only rounds — that's what disables the team-mode toggle.
  const partnerDescriptor = useMemo(
    () =>
      resolveActivePartners({
        games,
        rps: rps.map((r) => ({
          id: r.id,
          display_name: r.display_name,
          team_id: r.team_id ?? null
        })),
        currentHole: hole,
        totalHoles: totalHoles as 9 | 18
      }),
    [games, rps, hole, totalHoles]
  );
  // Default to team mode when a partner game is active. User can
  // override per-recording via the toggle below.
  const [teamMode, setTeamMode] = useState<boolean>(true);
  // Resolve the partners for the currently-selected player from the
  // partner descriptor. Returns [] when there's no partner game or
  // the selected player isn't in any side.
  const selectedPartners = useMemo<string[]>(() => {
    if (!selectedRp || !partnerDescriptor) return [];
    for (const side of partnerDescriptor.sides) {
      if (side.player_ids.includes(selectedRp)) {
        return side.player_ids.filter((id) => id !== selectedRp);
      }
    }
    return [];
  }, [selectedRp, partnerDescriptor]);

  /**
   * Compute the recipient list for a recording. When team-mode is on
   * AND the selected player has resolved partners, returns the full
   * team. Otherwise solo. Returns null (signaling "use solo default")
   * when the array would be just the primary player — saves on round-
   * trip arg size and keeps the audit log clean.
   */
  function resolveRecipients(): string[] | null {
    if (!selectedRp) return null;
    if (teamMode && selectedPartners.length > 0) {
      return [selectedRp, ...selectedPartners];
    }
    return null; // Solo — RPC will default to [p_round_player_id]
  }

  // After a successful save we briefly flash the last-recorded item id
  // so the items list highlights it green for ~1.2s. Patrick 2026-05-13
  // junk-UX feedback: "It is not clear when something is added." Visual
  // confirmation at the point the new item appears is the fix.
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  // `justRecorded` powers the inline confirmation card right under the
  // category chips so the user sees a save happen even before the
  // realtime refetch lands.
  const [justRecorded, setJustRecorded] = useState<{
    name: string;
    label: string;
    amount_cents: number;
    hole: number;
  } | null>(null);

  async function recordJunk(category: JunkCategory, customLabel?: string) {
    if (!selectedRp) {
      setErr("Pick the player who got it first.");
      return;
    }
    setPending(category);
    setErr(null);
    const recipients = resolveRecipients();
    const { data, error } = await sb.rpc("fn_record_junk", {
      p_round_id: roundId,
      p_round_player_id: selectedRp,
      p_hole_number: hole,
      p_category: category,
      p_custom_label: customLabel ?? null,
      p_note: null,
      p_recipient_ids: recipients
    });
    setPending(null);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    const name = nameById.get(selectedRp) ?? "Player";
    const label =
      category === "custom" && customLabel
        ? customLabel
        : categoryLabel(category);
    const teamSuffix =
      recipients && recipients.length > 1
        ? ` + ${recipients
            .filter((id) => id !== selectedRp)
            .map((id) => nameById.get(id) ?? "Player")
            .join(" + ")}`
        : "";
    // 1. Clear the player chip so the user sees a "fresh slate" instead
    //    of a sticky "✓ Pat" that reads like an unsaved draft.
    setSelectedRp(null);
    // 2. Inline confirmation card under the chip strip. Visible 4 seconds
    //    so the user actually sees it on a phone.
    setJustRecorded({
      name: `${name}${teamSuffix}`,
      label,
      amount_cents: (data as any)?.[0]?.amount_cents ?? previewAmount(category),
      hole
    });
    setTimeout(() => setJustRecorded(null), 4000);
    // 3. Flash the new item green in the items list.
    const newId = (data as any)?.[0]?.id ?? null;
    if (newId) {
      setFlashItemId(newId);
      setTimeout(() => setFlashItemId(null), 1500);
    }
    // 4. Keep the legacy toast string for accessibility / screen
    //    readers — same string, just shorter window since we now have
    //    the loud inline card.
    setToast(`${name}${teamSuffix} · ${label} · hole ${hole}`);
    setTimeout(() => setToast(null), 1800);
    router.refresh();
  }

  async function submitCustom() {
    const trimmed = customLabel.trim();
    if (trimmed.length === 0) {
      setErr("Custom junk needs a label.");
      return;
    }
    await recordJunk("custom", trimmed);
    setCustomMode(false);
    setCustomLabel("");
  }

  /**
   * Record a junk item using one of the commissioner's saved custom
   * categories. Wraps recordJunk so the spinner/toast state matches
   * the built-in chips, but uses a distinct pending key
   * (`custom:${key}`) so the chip-press visual targets the right
   * chip and not the generic "Other" button.
   */
  async function recordSavedCustom(key: string, label: string) {
    if (!selectedRp) {
      setErr("Pick the player who got it first.");
      return;
    }
    setPending(`custom:${key}`);
    setErr(null);
    const recipients = resolveRecipients();
    const { data, error } = await sb.rpc("fn_record_junk", {
      p_round_id: roundId,
      p_round_player_id: selectedRp,
      p_hole_number: hole,
      p_category: "custom",
      p_custom_label: label,
      p_note: null,
      p_recipient_ids: recipients
    });
    setPending(null);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    const name = nameById.get(selectedRp) ?? "Player";
    const teamSuffix =
      recipients && recipients.length > 1
        ? ` + ${recipients
            .filter((id) => id !== selectedRp)
            .map((id) => nameById.get(id) ?? "Player")
            .join(" + ")}`
        : "";
    // Same confirmation pattern as recordJunk — clear chip, surface
    // inline card, flash newest item. Patrick 2026-05-13 UX feedback.
    setSelectedRp(null);
    setJustRecorded({
      name: `${name}${teamSuffix}`,
      label,
      amount_cents: (data as any)?.[0]?.amount_cents ?? previewAmount("custom"),
      hole
    });
    setTimeout(() => setJustRecorded(null), 4000);
    const newId = (data as any)?.[0]?.id ?? null;
    if (newId) {
      setFlashItemId(newId);
      setTimeout(() => setFlashItemId(null), 1500);
    }
    setToast(`${name}${teamSuffix} · ${label} · hole ${hole}`);
    setTimeout(() => setToast(null), 1800);
    router.refresh();
  }

  // Inline "remove with reason" — the item being removed + its
  // pending reason text. window.prompt() works on desktop but is
  // blocked or terrible on iOS Safari PWA, which is the primary
  // mobile surface. Inline state + a tiny modal-ish row is the fix.
  const [removingItem, setRemovingItem] = useState<JunkItemRow | null>(null);
  const [removeReason, setRemoveReason] = useState("");

  function startRemove(item: JunkItemRow) {
    setRemovingItem(item);
    setRemoveReason("");
  }
  function cancelRemove() {
    setRemovingItem(null);
    setRemoveReason("");
  }
  async function confirmRemove() {
    const item = removingItem;
    if (!item) return;
    const trimmed = removeReason.trim();
    if (trimmed.length === 0) {
      setErr("Reason is required to remove a junk item.");
      return;
    }
    const { error } = await sb.rpc("fn_remove_junk", {
      p_item_id: item.id,
      p_reason: trimmed
    });
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setRemovingItem(null);
    setRemoveReason("");
    setErr(null);
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

      {/* Junk-closed state. The commissioner can disable junk mid-
          round by clearing active_categories on the config; the row
          is preserved (active_categories=[]) so historic items still
          settle at finalize. When that happens we hide the entry
          chips and show this notice so the panel doesn't read as
          broken. (Chaos QA 2026-05-12.) Treats saved custom
          categories as "open" too — a round can be running entirely
          on custom labels with no built-ins. */}
      {config.active_categories.length === 0 &&
        (config.custom_categories ?? []).length === 0 && (
        <div className="rounded-lg border border-cream-100/10 bg-brand-900/30 p-3 text-xs text-cream-100/75">
          Junk recording is closed for this round. The{" "}
          <span className="text-cream-50 tabular-nums">{items.length}</span>{" "}
          existing item{items.length === 1 ? "" : "s"} still settle at
          finalize.
          {isCommissioner && (
            <>
              {" "}Re-enable from{" "}
              <a
                href={`/rounds/${roundId}/games`}
                className="text-gold-400 hover:underline"
              >
                Games & bets
              </a>
              .
            </>
          )}
        </div>
      )}

      {/* Hole picker — defaults to current hole but commissioner / scorer
          can shift back for "I forgot to log Mit's birdie on 4". */}
      <div
        className={`flex items-center gap-2 flex-wrap text-xs ${
          config.active_categories.length === 0 &&
          (config.custom_categories ?? []).length === 0
            ? "hidden"
            : ""
        }`}
      >
        <label className="text-cream-100/65">Hole:</label>
        <select
          className="input text-sm px-2 py-1 w-auto"
          value={hole}
          onChange={(e) => {
            setHole(parseInt(e.target.value, 10));
            setHoleManuallySet(true);
          }}
        >
          {Array.from({ length: totalHoles }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      {/* Team-mode toggle — collapsed to a single compact line per
          Patrick 2026-05-13 UX feedback. The previous gold-bordered
          card read as a multi-step configurator ("set this up before
          recording"); a single inline pill makes clear it's just a
          mode flag, not a save gate. Tap to flip; defaults to team
          when a partner game is active. */}
      {partnerDescriptor && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-cream-100/65 px-1">
          <span>
            Awards →{" "}
            <span className="text-cream-50 font-medium">
              {teamMode ? "team (auto-credits partner)" : "solo (one player)"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setTeamMode((m) => !m)}
            className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
            aria-pressed={teamMode}
          >
            {teamMode ? "Switch to solo" : "Switch to team"}
          </button>
        </div>
      )}

      {/* Player chip row — hidden when junk recording is closed
          (both built-in + saved-custom lists are empty) so the panel
          collapses to "items still settle" + live totals only. */}
      <div
        className={`space-y-1.5 ${
          config.active_categories.length === 0 &&
          (config.custom_categories ?? []).length === 0
            ? "hidden"
            : ""
        }`}
      >
        <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
          {teamMode && partnerDescriptor
            ? "Who got it? (partner auto-credits)"
            : "Who got it?"}
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
          — Patrick's "tap the extras" UX). Also hidden when junk is
          closed for this round. */}
      <div
        className={`space-y-1.5 ${
          config.active_categories.length === 0 &&
          (config.custom_categories ?? []).length === 0
            ? "hidden"
            : ""
        }`}
      >
        <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
          Tap to record — saves immediately
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
          {/* Saved custom-category chips. Commissioner-managed via
              the games-editor (custom_categories JSONB on junk_config).
              Recorded as category="custom" + custom_label=<label> so
              the engine + settlement treat them like one-off customs,
              but the user gets one-tap entry instead of typing each
              time. Dashed border keeps them visually distinct from the
              built-in active_categories. */}
          {(config.custom_categories ?? []).map((c) => {
            const amt = previewAmount("custom");
            const isPending = pending === `custom:${c.key}`;
            return (
              <button
                key={`custom-${c.key}`}
                type="button"
                disabled={!selectedRp || pending !== null}
                title={`Saved custom: ${c.label}`}
                className={`pill text-xs px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                  !selectedRp
                    ? "bg-brand-900/30 text-cream-100/30 cursor-not-allowed"
                    : isPending
                    ? "bg-gold-500/40 text-cream-50"
                    : "bg-brand-900/60 border border-dashed border-cream-100/30 text-cream-100/85 hover:bg-gold-500/15 hover:border-gold-500/50"
                }`}
                onClick={() => recordSavedCustom(c.key, c.label)}
              >
                <span>{c.label}</span>
                <span className="text-gold-400 tabular-nums text-[10px]">
                  {fmtFlat$(amt)}
                </span>
              </button>
            );
          })}
          {/* "+ Other" — expands to an inline label input. Lets the
              user record one-off junk like "Woodie" or "Wilson
              special" without going through Edit games. Engine + RPC
              accept category="custom" unconditionally (doesn't have
              to be in active_categories) so long as a label is
              supplied. */}
          <button
            type="button"
            disabled={!selectedRp || pending !== null || customMode}
            title="Record a one-off junk item with a custom label (e.g. Woodie, Wilson special)"
            className={`pill text-xs px-3 py-1.5 transition-colors ${
              !selectedRp
                ? "bg-brand-900/30 text-cream-100/30 cursor-not-allowed"
                : "bg-brand-900/60 border border-dashed border-cream-100/30 text-cream-100/85 hover:bg-gold-500/15 hover:border-gold-500/50"
            }`}
            onClick={() => setCustomMode(true)}
          >
            + Other
          </button>
        </div>
        {customMode && selectedRp && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <input
              type="text"
              className="input text-sm flex-1 min-w-[10rem]"
              placeholder="Custom label (e.g. Woodie, Wilson special)"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCustom();
                if (e.key === "Escape") {
                  setCustomMode(false);
                  setCustomLabel("");
                }
              }}
              autoFocus
              maxLength={40}
            />
            <span className="text-[10px] text-gold-400 tabular-nums">
              {fmtFlat$(previewAmount("custom"))}
            </span>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={customLabel.trim().length === 0 || pending !== null}
              onClick={submitCustom}
            >
              Record
            </button>
            <button
              type="button"
              className="btn-ghost text-xs text-cream-100/65"
              onClick={() => {
                setCustomMode(false);
                setCustomLabel("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {!selectedRp && (
          <p className="text-[10px] text-cream-100/45">
            Select a player above first.
          </p>
        )}
      </div>

      {/* Inline confirmation card — replaces the tiny green toast that
          was invisible on a 375px iPhone (Patrick 2026-05-13: "It is
          not clear when something is added"). 4s window, large enough
          to read from the bottom of the screen. The `toast` is kept as
          an accessibility-only screen-reader hint below. */}
      {justRecorded && (
        <div
          className="card p-3 border border-emerald-400/40 bg-emerald-500/10 flex items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <span className="text-2xl shrink-0" aria-hidden="true">✓</span>
          <div className="min-w-0 flex-1">
            <p className="text-emerald-200 font-medium text-sm leading-tight truncate">
              Recorded {justRecorded.label}
            </p>
            <p className="text-[11px] text-cream-100/85 mt-0.5 leading-tight truncate">
              {justRecorded.name} · hole {justRecorded.hole} ·{" "}
              <span className="tabular-nums">
                {fmtFlat$(justRecorded.amount_cents)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="text-emerald-200/65 hover:text-emerald-100 text-xs shrink-0"
            onClick={() => setJustRecorded(null)}
            aria-label="Dismiss confirmation"
          >
            ✕
          </button>
        </div>
      )}
      {toast && (
        <p className="sr-only" role="status" aria-live="polite">
          Recorded: {toast}
        </p>
      )}

      {/* Inline remove dialog — replaces window.prompt(), which is
          blocked / awful on iOS Safari PWA. Surfaces above the
          totals so the user's flow is obvious. */}
      {removingItem && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 space-y-2">
          <p className="text-xs text-red-200">
            Remove this junk item?
          </p>
          <p className="text-[11px] text-cream-100/85">
            {nameById.get(removingItem.round_player_id) ?? "Player"} ·{" "}
            {categoryLabel(removingItem.category)} · hole{" "}
            {removingItem.hole_number} ·{" "}
            <span className="tabular-nums">
              {fmtFlat$(removingItem.amount_cents)}
            </span>
          </p>
          <input
            type="text"
            className="input text-sm w-full"
            placeholder="Reason (required) — e.g. duplicate, wrong player"
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="btn-ghost text-xs text-cream-100/65"
              onClick={cancelRemove}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={removeReason.trim().length === 0}
              onClick={confirmRemove}
            >
              Remove
            </button>
          </div>
        </div>
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

          {/* Item log — always visible (no <details> wrapper) so the
              user sees their recording appear in the list the moment
              it lands. Patrick 2026-05-13: "It is not clear when
              something is added." Newest item flashes emerald for
              ~1.5s after recording so the eye is drawn to it. Top 5
              shown by default; "Show all" toggle expands if more
              accumulate over a long round. */}
          <ItemList
            items={items}
            nameById={nameById}
            flashItemId={flashItemId}
            isCommissioner={isCommissioner}
            onRemove={startRemove}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Always-visible item list — newest first. Caps at 5 items by default
 * with a "Show all (N)" expand control when more accumulate. The
 * `flashItemId` prop drives a one-shot 1.5s emerald-tinted background
 * highlight on the item just recorded, so the user's eye is pulled to
 * the new entry. Without this the user has no clear "your recording
 * landed" signal — they're left guessing whether the tap registered.
 *
 * Remove buttons render only for commissioners. Everyone else sees
 * read-only rows; if they tap a junk wrong, the commissioner removes
 * it post-hoc with a reason (audit-logged).
 */
function ItemList({
  items,
  nameById,
  flashItemId,
  isCommissioner,
  onRemove
}: {
  items: JunkItemRow[];
  nameById: Map<string, string>;
  flashItemId: string | null;
  isCommissioner: boolean;
  onRemove: (item: JunkItemRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const visible = showAll ? sorted : sorted.slice(0, 5);
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-cream-100/55">
        Recorded ({items.length})
      </p>
      <ul className="space-y-1 text-xs">
        {visible.map((it) => {
          const isFlashing = flashItemId === it.id;
          const recipients = (it as any).recipient_ids as string[] | undefined;
          const isTeam =
            (it as any).is_team_award === true ||
            (Array.isArray(recipients) && recipients.length > 1);
          const primaryName = nameById.get(it.round_player_id) ?? "Player";
          const partnerNames =
            isTeam && recipients
              ? recipients
                  .filter((id) => id !== it.round_player_id)
                  .map((id) => nameById.get(id) ?? "Player")
              : [];
          const displayName =
            partnerNames.length > 0
              ? `${primaryName} + ${partnerNames.join(" + ")}`
              : primaryName;
          return (
            <li
              key={it.id}
              className={`flex items-center justify-between gap-2 rounded-md px-3 py-1.5 transition-colors ${
                isFlashing
                  ? "bg-emerald-500/25 ring-1 ring-emerald-400/50"
                  : "bg-brand-900/30"
              }`}
            >
              <span className="min-w-0 truncate">
                {isFlashing && (
                  <span
                    className="text-emerald-300 mr-1"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                )}
                <span className="text-cream-50">{displayName}</span>
                {isTeam && (
                  <span className="text-[9px] uppercase tracking-wider text-gold-400/85 ml-1.5">
                    team
                  </span>
                )}
                <span className="text-cream-100/65">
                  {" "}
                  ·{" "}
                  {it.category === "custom" && it.custom_label
                    ? it.custom_label
                    : categoryLabel(it.category)}
                </span>
                <span className="text-cream-100/55"> · hole {it.hole_number}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-gold-400 tabular-nums">
                  ${(it.amount_cents / 100).toFixed(2)}
                </span>
                {isCommissioner && (
                  <button
                    type="button"
                    className="text-cream-100/45 hover:text-red-300"
                    onClick={() => onRemove(it)}
                    aria-label="Remove this junk item"
                    title="Remove (commissioner)"
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {sorted.length > 5 && (
        <button
          type="button"
          className="text-[11px] text-cream-100/65 hover:text-cream-100"
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll
            ? "Show fewer"
            : `Show all (${sorted.length}) →`}
        </button>
      )}
    </div>
  );
}
