"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  GAME_FAMILIES,
  getFamily,
  getPreset,
  type GameFamily
} from "@/lib/games/library";
import {
  categoryLabel,
  DEFAULT_JUNK_CONFIG,
  type JunkCategory,
  type JunkConfig
} from "@/lib/games/junk";
import type { GameType } from "@/lib/types";

type Game = {
  id: string;
  game_type: GameType;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: Record<string, unknown>;
};

export type RoundPlayerLite = {
  /** round_player_id */
  id: string;
  display_name: string;
};

export function GamesEditor({
  roundId,
  initialGames,
  players,
  initialJunkConfig,
  hasScores
}: {
  roundId: string;
  initialGames: Game[];
  /** Round players in seat order. Used by the 6-6-6 rotation editor. */
  players: RoundPlayerLite[];
  /** Current junk config if enabled, null when junk is off for this
   *  round. Surfaced through JunkConfigBlock at the bottom of the
   *  editor. */
  initialJunkConfig: JunkConfig | null;
  hasScores: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [games, setGames] = useState<Game[]>(initialGames);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function patchGame(g: Game, patch: Partial<Game>) {
    setBusy(true);
    setErr(null);
    const { error } = await sb.from("round_games").update(patch).eq("id", g.id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setGames((arr) => arr.map((x) => (x.id === g.id ? { ...x, ...patch } : x)));
    router.refresh();
  }

  async function removeGame(g: Game) {
    const ok = confirm(
      hasScores
        ? `Remove "${g.name}"? Scores already exist; the settlement will recompute without this game.`
        : `Remove "${g.name}"?`
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const { error } = await sb.from("round_games").delete().eq("id", g.id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setGames((arr) => arr.filter((x) => x.id !== g.id));
    router.refresh();
  }

  async function addGame(payload: {
    game_type: GameType;
    name: string;
    stake_cents: number;
    allowance_pct: number;
    config: Record<string, unknown>;
  }) {
    setBusy(true);
    setErr(null);
    const { data, error } = await sb
      .from("round_games")
      .insert({ round_id: roundId, ...payload })
      .select("id, game_type, name, stake_cents, allowance_pct, config")
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Could not add game.");
      return;
    }
    setGames((arr) => [...arr, data as any]);
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {hasScores && (
        <p className="text-xs text-amber-200/85 bg-amber-500/10 border border-amber-400/30 rounded-lg p-3">
          ⚠ Scores are already entered. Edits here change the settlement —
          stakes/configs are re-applied when the round is finalized.
        </p>
      )}

      {games.length === 0 && !adding && (
        <div className="card p-6 text-center">
          <p className="text-sm text-cream-100/65">
            No games configured for this round.
          </p>
          <button
            type="button"
            className="btn-primary mt-3"
            onClick={() => setAdding(true)}
          >
            + Add a game
          </button>
        </div>
      )}

      <div className="space-y-2">
        {games.map((g) => (
          <GameCard
            key={g.id}
            game={g}
            players={players}
            disabled={busy}
            onPatch={(p) => patchGame(g, p)}
            onRemove={() => removeGame(g)}
          />
        ))}
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {games.length > 0 && !adding && (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAdding(true)}
          disabled={busy}
        >
          + Add another game
        </button>
      )}

      {adding && (
        <AddGameForm
          existing={games}
          onCancel={() => setAdding(false)}
          onAdd={addGame}
          busy={busy}
        />
      )}

      <JunkConfigBlock
        roundId={roundId}
        initialConfig={initialJunkConfig}
        disabled={busy}
      />
    </div>
  );
}

// ============================================================
// JunkConfigBlock
// ============================================================
/**
 * Commissioner-only block for enabling and configuring junk side-bets
 * for a round. Calls SECURITY DEFINER fn_set_junk_config so the DB is
 * authoritative on RBAC + finalize-gate.
 *
 * Defaults match `lib/games/junk.ts:DEFAULT_JUNK_CONFIG`: $2 base, $2
 * escalating, per-round, 7 categories active.
 *
 * Removing junk is "set active_categories=[]" — we keep the row so
 * historic items still settle, but no new items can be recorded.
 */
function JunkConfigBlock({
  roundId,
  initialConfig,
  disabled
}: {
  roundId: string;
  initialConfig: JunkConfig | null;
  disabled: boolean;
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  // "Enabled" iff a config row exists AND at least one category is
  // active. Disable persists the row with active_categories=[] so
  // historic items still settle — but treating that as enabled would
  // re-open the config panel on reload, confusing the commissioner.
  const initialHasActiveCats =
    initialConfig !== null && (initialConfig.active_categories?.length ?? 0) > 0;
  const [enabled, setEnabled] = useState(initialHasActiveCats);
  const [config, setConfig] = useState<JunkConfig>(
    initialConfig ?? DEFAULT_JUNK_CONFIG
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // All built-in categories (display order matches Patrick's list).
  // "custom" is intentionally not in the toggle list — custom labels
  // go through the entry UI's "+ Other" path.
  const ALL_CATEGORIES: JunkCategory[] = [
    "birdie",
    "eagle",
    "greenie",
    "sandy",
    "chip_in",
    "poley",
    "pinny",
    "barkie",
    "net_birdie"
  ];

  /**
   * Persist a config change. Returns true on success, false on
   * failure. Callers MUST await + revert local state if false, or
   * the UI lies (says "saved" while the DB still has the old config).
   * The prior fire-and-forget pattern silently dropped errors and
   * was caught in the 2026-05-12 code review.
   */
  async function save(next: JunkConfig): Promise<boolean> {
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("fn_set_junk_config", {
      p_round_id: roundId,
      p_active_categories: next.active_categories,
      p_mode: next.mode,
      p_flat_amount_cents: next.flat_amount_cents ?? null,
      p_base_amount_cents: next.base_amount_cents ?? null,
      p_escalation_step_cents: next.escalation_step_cents ?? null,
      p_escalation_scope: next.escalation_scope ?? null,
      p_custom_categories: next.custom_categories ?? null
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    setSavedAt(Date.now());
    router.refresh();
    return true;
  }

  async function enable() {
    const prev = { enabled, config };
    setEnabled(true);
    setConfig(DEFAULT_JUNK_CONFIG);
    const ok = await save(DEFAULT_JUNK_CONFIG);
    if (!ok) {
      setEnabled(prev.enabled);
      setConfig(prev.config);
    }
  }

  async function disable() {
    if (
      !confirm(
        "Turn junk off for this round? Items already recorded stay in the audit log but new ones can't be added. You can re-enable at any time before finalize."
      )
    ) {
      return;
    }
    const prev = { enabled, config };
    const next: JunkConfig = { ...config, active_categories: [] };
    setConfig(next);
    setEnabled(false);
    const ok = await save(next);
    if (!ok) {
      setEnabled(prev.enabled);
      setConfig(prev.config);
    }
  }

  async function toggleCategory(cat: JunkCategory) {
    const prevConfig = config;
    const next: JunkConfig = {
      ...config,
      active_categories: config.active_categories.includes(cat)
        ? config.active_categories.filter((c) => c !== cat)
        : [...config.active_categories, cat]
    };
    setConfig(next);
    const ok = await save(next);
    if (!ok) {
      // Revert the optimistic chip toggle so what the user sees
      // matches what the DB knows.
      setConfig(prevConfig);
    }
  }

  if (!enabled) {
    return (
      <div className="card p-4 border border-dashed border-cream-100/15 space-y-2">
        <p className="h-eyebrow">Junk side-bets</p>
        <p className="text-xs text-cream-100/65 leading-snug">
          Side bets on birdies, greenies, sandies, chip-ins, poleys, pinnies
          — tap-the-extras tracking that runs alongside the main game.
          Default is <span className="font-medium">$2 flat</span> per item
          — toggle to escalating below if you prefer the pot growing as
          junk piles up.
        </p>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={enable}
          disabled={disabled || busy}
        >
          + Enable junk for this round
        </button>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3 border border-gold-500/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Junk side-bets</p>
          <p className="text-[11px] text-cream-100/55 leading-snug">
            Server-side authoritative pricing. Recorded amounts freeze on entry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-[10px] text-emerald-300">Saved</span>
          )}
          <button
            type="button"
            className="btn-ghost text-xs text-red-300"
            onClick={disable}
            disabled={disabled || busy}
          >
            Disable
          </button>
        </div>
      </div>

      {/* Mode + amounts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Mode</label>
          <select
            className="input"
            value={config.mode}
            disabled={disabled || busy}
            onChange={(e) => {
              const mode = e.target.value as "flat" | "escalating";
              const next = { ...config, mode };
              setConfig(next);
              save(next);
            }}
          >
            <option value="escalating">Escalating</option>
            <option value="flat">Flat</option>
          </select>
        </div>
        {config.mode === "flat" ? (
          <div className="sm:col-span-2">
            <label className="label">Amount per item (USD)</label>
            <input
              className="input"
              type="number"
              step="0.50"
              min={0}
              defaultValue={(config.flat_amount_cents ?? 200) / 100}
              key={`flat-${config.flat_amount_cents}`}
              onBlur={(e) => {
                // Blank input or non-numeric was silently saving $0
                // — a $0 flat means every junk pays nothing, which
                // no one wants. Revert to the previous value if the
                // user cleared the field.
                const dollars = parseFloat(e.currentTarget.value);
                if (!Number.isFinite(dollars) || dollars <= 0) {
                  e.currentTarget.value = String(
                    (config.flat_amount_cents ?? 200) / 100
                  );
                  return;
                }
                const cents = Math.round(dollars * 100);
                if (cents === (config.flat_amount_cents ?? 200)) return;
                const prevConfig = config;
                const next = { ...config, flat_amount_cents: cents };
                setConfig(next);
                save(next).then((ok) => {
                  if (!ok) setConfig(prevConfig);
                });
              }}
              disabled={disabled || busy}
            />
          </div>
        ) : (
          <>
            <div>
              <label className="label">Base (USD)</label>
              <input
                className="input"
                type="number"
                step="0.50"
                min={0}
                defaultValue={(config.base_amount_cents ?? 200) / 100}
                key={`base-${config.base_amount_cents}`}
                onBlur={(e) => {
                  // Revert blank / non-numeric / ≤0 — base $0 makes
                  // the first item free, which isn't a real rule.
                  const dollars = parseFloat(e.currentTarget.value);
                  if (!Number.isFinite(dollars) || dollars <= 0) {
                    e.currentTarget.value = String(
                      (config.base_amount_cents ?? 200) / 100
                    );
                    return;
                  }
                  const cents = Math.round(dollars * 100);
                  if (cents === (config.base_amount_cents ?? 200)) return;
                  const prevConfig = config;
                  const next = { ...config, base_amount_cents: cents };
                  setConfig(next);
                  save(next).then((ok) => {
                    if (!ok) setConfig(prevConfig);
                  });
                }}
                disabled={disabled || busy}
              />
            </div>
            <div>
              <label className="label">Step (USD)</label>
              <input
                className="input"
                type="number"
                step="0.50"
                min={0}
                defaultValue={(config.escalation_step_cents ?? 200) / 100}
                key={`step-${config.escalation_step_cents}`}
                onBlur={(e) => {
                  // Step = 0 is a legitimate "escalating but flat-
                  // ish" config (everyone pays base, never climbs)
                  // but blank input shouldn't write it. Revert on
                  // blank / non-numeric, allow explicit 0.
                  const raw = e.currentTarget.value;
                  if (raw.trim() === "") {
                    e.currentTarget.value = String(
                      (config.escalation_step_cents ?? 200) / 100
                    );
                    return;
                  }
                  const dollars = parseFloat(raw);
                  if (!Number.isFinite(dollars) || dollars < 0) {
                    e.currentTarget.value = String(
                      (config.escalation_step_cents ?? 200) / 100
                    );
                    return;
                  }
                  const cents = Math.round(dollars * 100);
                  if (cents === (config.escalation_step_cents ?? 200)) return;
                  const prevConfig = config;
                  const next = { ...config, escalation_step_cents: cents };
                  setConfig(next);
                  save(next).then((ok) => {
                    if (!ok) setConfig(prevConfig);
                  });
                }}
                disabled={disabled || busy}
              />
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                Each new item adds this to the previous.
              </p>
            </div>
          </>
        )}
      </div>

      {config.mode === "escalating" && (
        <div>
          <label className="label">Escalation scope</label>
          <select
            className="input"
            value={config.escalation_scope ?? "per_round"}
            disabled={disabled || busy}
            onChange={(e) => {
              const next: JunkConfig = {
                ...config,
                escalation_scope: e.target.value as any
              };
              setConfig(next);
              save(next);
            }}
          >
            <option value="per_round">
              Per round — the pot grows every junk
            </option>
            <option value="per_category">
              Per category — birdies escalate independent of greenies
            </option>
            <option value="per_player_per_category">
              Per player per category — each player&apos;s repeats only
            </option>
          </select>
        </div>
      )}

      {/* Category toggles */}
      <div>
        <p className="label">Categories</p>
        <p className="text-[11px] text-cream-100/55 mb-2 leading-snug">
          Tap to toggle. Disabled categories don&apos;t show on the
          entry chip strip — but historic items in those categories still
          settle.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_CATEGORIES.map((cat) => {
            const active = config.active_categories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                className={`pill text-xs px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/55"
                }`}
                onClick={() => toggleCategory(cat)}
                disabled={disabled || busy}
              >
                {active ? "✓ " : ""}
                {categoryLabel(cat)}
              </button>
            );
          })}
        </div>
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}

function GameCard({
  game,
  players,
  disabled,
  onPatch,
  onRemove
}: {
  game: Game;
  players: RoundPlayerLite[];
  disabled: boolean;
  onPatch: (patch: Partial<Game>) => void;
  onRemove: () => void;
}) {
  const preset = getPreset(game.game_type);
  const isSkins = game.game_type.startsWith("skins");
  const isNassau = game.game_type === "nassau";
  const isTeamGame =
    game.game_type === "best_ball_gross" ||
    game.game_type === "best_ball_net" ||
    game.game_type === "aggregate_gross" ||
    game.game_type === "aggregate_net";
  // 6-6-6 + match_play also support cfg.match_play + cfg.presses
  // through the same TeamMatchPlayConfig block. Nassau has its own
  // dedicated config (front/back/overall stakes + presses) so it's
  // excluded here.
  const isSixSixSix = game.game_type === "six_six_six";
  const isMatchPlayGame = game.game_type === "match_play";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-serif text-lg text-cream-50">{game.name}</div>
          {preset && (
            <p className="text-xs text-cream-100/55 mt-0.5">{preset.short}</p>
          )}
        </div>
        {preset?.hasGrossNetToggle && preset.toggleTo && (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={() => {
              const next = getPreset(preset.toggleTo!);
              if (!next) return;
              const newName = game.name === preset.label ? next.label : game.name;
              onPatch({ game_type: preset.toggleTo, name: newName });
            }}
          >
            Switch to {getPreset(preset.toggleTo)?.label}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            value={game.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            disabled={disabled}
          />
        </div>
        {!isNassau && !isSkins && (
          <div>
            <label className="label">Stake (USD)</label>
            <input
              className="input"
              type="number"
              step="0.50"
              min={0}
              defaultValue={game.stake_cents / 100}
              onBlur={(e) => {
                const dollars = parseFloat(e.target.value);
                const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
                onPatch({ stake_cents: cents });
              }}
              disabled={disabled}
            />
          </div>
        )}
        {isSkins && (
          <SkinsConfigBlock
            config={game.config ?? {}}
            disabled={disabled}
            onPatch={(c) => onPatch({ config: c })}
          />
        )}
        <div>
          <label className="label">Hcp Allowance %</label>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            defaultValue={game.allowance_pct}
            key={game.allowance_pct}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const v = parseInt(e.currentTarget.value, 10);
              onPatch({ allowance_pct: Number.isFinite(v) ? v : 100 });
            }}
            disabled={disabled}
          />
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            % of full handicap players get. 100 = full strokes, 85 = standard
            match-play scaling.
          </p>
        </div>
      </div>

      {isNassau && <NassauConfig game={game} disabled={disabled} onPatch={onPatch} />}
      {(isTeamGame || isSixSixSix || isMatchPlayGame) && (
        <TeamMatchPlayConfig
          game={game}
          players={players}
          disabled={disabled}
          onPatch={onPatch}
          gameType={
            isSixSixSix
              ? "six_six_six"
              : isMatchPlayGame
              ? "match_play"
              : "team"
          }
        />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-ghost text-xs text-red-300"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove this game
        </button>
      </div>
    </div>
  );
}

/**
 * Skins config block. Two payout modes:
 *  - "pot"   (default): every player buys in. The total pot (buyin × N
 *            players) is divided EQUALLY among every skin won. So 4 skins
 *            on a $160 pot = $40/skin. Number of players is determined at
 *            settlement time.
 *  - "fixed":            each skin pays a fixed dollar amount.
 *
 * Advanced (collapsed by default): ties carry/split, birdie validation,
 * carry escalation. Sensible defaults: ties carry, no birdie required,
 * linear escalation.
 */
function SkinsConfigBlock({
  config,
  disabled,
  onPatch
}: {
  config: Record<string, unknown>;
  disabled: boolean;
  onPatch: (next: Record<string, unknown>) => void;
}) {
  const skinMode: "pot" | "fixed" =
    (config.skin_mode as any) ??
    ((config.skin_value_cents as number) != null && (config.buyin_cents as number) == null
      ? "fixed"
      : "pot");
  const buyinDollars = ((config.buyin_cents as number) ?? 2000) / 100;
  const skinValueDollars = ((config.skin_value_cents as number) ?? 200) / 100;
  const ties = (config.ties as string) ?? "carry";
  const requireBirdie = !!config.require_birdie;
  const escalation = (config.escalation as string) ?? "linear";
  const [showAdvanced, setShowAdvanced] = useState(false);

  function set(next: Record<string, unknown>) {
    onPatch({ ...config, ...next });
  }

  return (
    <div className="sm:col-span-2 rounded-lg border border-cream-100/10 p-3 space-y-3">
      <div>
        <label className="label">Payout style</label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => set({ skin_mode: "pot" })}
            className={`pill text-xs px-3 py-1.5 ${
              skinMode === "pot"
                ? "bg-gold-500 text-brand-900"
                : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
            }`}
          >
            Pot-based
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => set({ skin_mode: "fixed" })}
            className={`pill text-xs px-3 py-1.5 ${
              skinMode === "fixed"
                ? "bg-gold-500 text-brand-900"
                : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
            }`}
          >
            Fixed value
          </button>
        </div>
        <p className="text-[10px] text-cream-100/55 mt-1">
          {skinMode === "pot"
            ? "Everyone buys in. Whatever skins are won, the pot is divided equally among them."
            : "Each skin pays a fixed dollar amount, regardless of how many are won."}
        </p>
      </div>

      {skinMode === "pot" ? (
        <div>
          <label className="label">Buy-in per player (USD)</label>
          <input
            className="input"
            type="number"
            step="0.50"
            min={0}
            defaultValue={buyinDollars}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              set({ buyin_cents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
            }}
            disabled={disabled}
          />
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            Example: 8 players × $20 = $160 pot. If 5 skins are won, each is
            worth $32.
          </p>
        </div>
      ) : (
        <div>
          <label className="label">Each skin (USD)</label>
          <input
            className="input"
            type="number"
            step="0.50"
            min={0}
            defaultValue={skinValueDollars}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              set({ skin_value_cents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
            }}
            disabled={disabled}
          />
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            Example: $10 a skin × 5 skins = $50 total moves at the end.
          </p>
        </div>
      )}

      <button
        type="button"
        className="text-[11px] text-cream-100/55 hover:text-cream-50"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "▾ Hide advanced" : "▸ Advanced (ties, birdie, carry)"}
      </button>
      {showAdvanced && (
        <div className="space-y-2 pt-1 border-t border-cream-100/10">
          <div>
            <label className="label">Tied holes</label>
            <select
              className="input"
              value={ties}
              onChange={(e) => set({ ties: e.target.value })}
              disabled={disabled}
            >
              <option value="carry">Carry — tie pushes the skin to the next hole</option>
              <option value="split">Split — pot splits between tied players</option>
              <option value="nullify">Nullify — tied holes are dropped</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-cream-100/85">
            <input
              type="checkbox"
              checked={requireBirdie}
              onChange={(e) => set({ require_birdie: e.target.checked })}
              disabled={disabled}
            />
            Birdie or better required (Canadian-style)
          </label>
          {skinMode === "fixed" && ties === "carry" && (
            <div>
              <label className="label">Carry value</label>
              <select
                className="input"
                value={escalation}
                onChange={(e) => set({ escalation: e.target.value })}
                disabled={disabled}
              >
                <option value="linear">Add — every carry adds the base value</option>
                <option value="double">Double — value doubles after each carry</option>
                <option value="flat">Flat — value never changes</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NassauConfig({
  game,
  disabled,
  onPatch
}: {
  game: Game;
  disabled: boolean;
  onPatch: (patch: Partial<Game>) => void;
}) {
  const c = game.config ?? {};
  const front = ((c as any).front_stake_cents ?? 0) as number;
  const back = ((c as any).back_stake_cents ?? 0) as number;
  const overall = ((c as any).overall_stake_cents ?? 0) as number;
  const presses = !!(c as any).presses_enabled;

  function setStake(key: "front_stake_cents" | "back_stake_cents" | "overall_stake_cents", dollars: number) {
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    onPatch({ config: { ...(c as any), [key]: cents } });
  }

  return (
    <div className="rounded-lg border border-cream-100/10 p-3 space-y-2">
      <p className="text-xs text-cream-100/55">
        Three side bets. Common pattern is equal stakes ($5/$5/$5).
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Front 9", "front_stake_cents", front],
            ["Back 9", "back_stake_cents", back],
            ["Overall", "overall_stake_cents", overall]
          ] as const
        ).map(([label, key, val]) => (
          <div key={key}>
            <label className="label">{label} (USD)</label>
            <input
              className="input"
              type="number"
              step="0.50"
              min={0}
              value={(val as number) / 100}
              onChange={(e) => setStake(key, parseFloat(e.target.value))}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-cream-100/85">
        <input
          type="checkbox"
          checked={presses}
          onChange={(e) =>
            onPatch({ config: { ...(c as any), presses_enabled: e.target.checked } })
          }
          disabled={disabled}
        />
        Allow presses
      </label>
    </div>
  );
}

/**
 * Match-play + presses config block for Best Ball / Aggregate.
 *
 * Default is stroke play (cumulative team total wins). Toggling to
 * match-play enables hole-by-hole settlement and unlocks the auto-
 * press option (settles via the same press primitive Nassau uses).
 *
 * Engine: lib/games/team.ts respects cfg.match_play + cfg.presses.
 */
function TeamMatchPlayConfig({
  game,
  players,
  disabled,
  onPatch,
  gameType = "team"
}: {
  game: Game;
  players: RoundPlayerLite[];
  disabled: boolean;
  onPatch: (patch: Partial<Game>) => void;
  /** Adjusts wording + default. 6-6-6 + match_play default to match
   *  play; team games (best ball / aggregate) default to stroke. */
  gameType?: "team" | "six_six_six" | "match_play";
}) {
  const c = (game.config ?? {}) as Record<string, unknown>;
  // 6-6-6 + match_play default to match-play if cfg unset; team games
  // default to stroke.
  const defaultsToMatch = gameType !== "team";
  const matchPlay =
    c.match_play === undefined ? defaultsToMatch : c.match_play === true;
  const presses = (c.presses as string) ?? "none";

  return (
    <div className="rounded-lg border border-cream-100/10 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Format</label>
          <select
            className="input"
            value={matchPlay ? "match" : "stroke"}
            disabled={disabled}
            onChange={(e) =>
              onPatch({
                config: { ...c, match_play: e.target.value === "match" }
              })
            }
          >
            <option value="stroke">Stroke (lowest total wins)</option>
            <option value="match">Match (hole by hole)</option>
          </select>
        </div>
        {matchPlay && (
          <div>
            <label className="label">Presses</label>
            <select
              className="input"
              value={presses}
              disabled={disabled}
              onChange={(e) => onPatch({ config: { ...c, presses: e.target.value } })}
            >
              <option value="none">None</option>
              <option value="auto_2_down">Auto-press at 2 down</option>
            </select>
          </div>
        )}
      </div>
      {matchPlay && (
        <p className="text-[11px] text-cream-100/55 leading-snug">
          Match play settles hole by hole. Presses (when on) open
          automatically when one team is 2 down with 3+ holes left.
          Capped at 4 presses per match.
        </p>
      )}
      {gameType === "six_six_six" && (
        <SixSixSixRotationEditor
          game={game}
          players={players}
          disabled={disabled}
          onPatch={onPatch}
        />
      )}
    </div>
  );
}

/**
 * 6-6-6 partner-rotation editor.
 *
 * Real-world feedback from a tester: "we played sixes rotating partners
 * and I couldn't figure out how to change the teams." Without an editor,
 * the engine quietly defaults to seat-order pairings:
 *   Seg 1 (1-6):   players[0] + players[1]  vs  players[2] + players[3]
 *   Seg 2 (7-12):  players[0] + players[2]  vs  players[1] + players[3]
 *   Seg 3 (13-18): players[0] + players[3]  vs  players[1] + players[2]
 *
 * That's a valid round-robin, but every group has a "best player partners
 * each weakest in turn" preference and the existing UI hid the pairings
 * entirely. This editor surfaces them and lets the commissioner swap
 * partners per segment.
 *
 * Constraint: in a 4-player round-robin, every player must be on Side A
 * exactly once across the 3 segments. We don't enforce that in the UI
 * (would require a constraint solver) — instead we show the three
 * segments' pairings, let the commissioner set Side A's two members for
 * each segment via a dropdown, and auto-derive Side B as "the other two".
 * If they pick something dumb (same pair in two segments), the engine
 * still runs — it's just a suboptimal rotation.
 *
 * Persists to game.config.rotation = [{ team_a, team_b }, { ... }, ...]
 * — the exact shape the engine reads in `lib/games/six_six_six.ts`.
 */
function SixSixSixRotationEditor({
  game,
  players,
  disabled,
  onPatch
}: {
  game: Game;
  players: RoundPlayerLite[];
  disabled: boolean;
  onPatch: (patch: Partial<Game>) => void;
}) {
  const c = (game.config ?? {}) as Record<string, unknown>;
  const cfgRotation = c.rotation as
    | Array<{ team_a: [string, string]; team_b: [string, string] }>
    | undefined;

  // 6-6-6 needs exactly 4 players. Outside that case, render a gentle
  // hint instead of a broken editor.
  if (players.length !== 4) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        6-6-6 needs exactly 4 players. This round has{" "}
        <span className="font-medium">{players.length}</span>. Partner
        rotation will be unavailable until the player count is 4.
      </div>
    );
  }

  // Compute effective rotation — config OR default (seat-order).
  const ids = players.map((p) => p.id);
  const defaultRotation: Array<{
    team_a: [string, string];
    team_b: [string, string];
  }> = [
    { team_a: [ids[0], ids[1]], team_b: [ids[2], ids[3]] },
    { team_a: [ids[0], ids[2]], team_b: [ids[1], ids[3]] },
    { team_a: [ids[0], ids[3]], team_b: [ids[1], ids[2]] }
  ];
  const effective = cfgRotation ?? defaultRotation;
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));

  function setSegmentPair(segIdx: number, aPair: [string, string]) {
    const allIds = new Set(ids);
    aPair.forEach((id) => allIds.delete(id));
    const bPair = [...allIds] as [string, string];
    const next = effective.map((seg, i) =>
      i === segIdx
        ? { team_a: aPair, team_b: bPair }
        : seg
    );
    onPatch({ config: { ...c, rotation: next } });
  }

  function resetToDefault() {
    onPatch({ config: { ...c, rotation: undefined } });
  }

  // For the Side A dropdown of a segment, build the list of valid
  // 2-of-4 pair options. We use a stable representation
  // (sorted by id) so two equivalent pairs render identically.
  const allPairs: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      allPairs.push([ids[i], ids[j]]);
    }
  }

  // Validation: across 3 segments, every PAIR appears at most once. A
  // perfect round-robin uses each of the three possible partnerships.
  // We don't enforce — golfers customize for real reasons — but flag
  // if the commissioner picks something most groups wouldn't.
  const pairKeys = new Set<string>();
  let pairsDuplicate = false;
  for (const seg of effective) {
    const k = [...seg.team_a].sort().join("|");
    if (pairKeys.has(k)) {
      pairsDuplicate = true;
      break;
    }
    pairKeys.add(k);
  }

  return (
    <div className="rounded-lg border border-cream-100/10 p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <p className="font-medium text-cream-50 text-sm">
            Partner rotation
          </p>
          <p className="text-[11px] text-cream-100/55 leading-snug">
            6-6-6 plays three 6-hole matches, rotating partners each segment.
            The default rotates seat order. Tap a segment to set the pair.
          </p>
        </div>
        {cfgRotation && (
          <button
            type="button"
            className="btn-ghost text-[11px] text-cream-100/65"
            onClick={resetToDefault}
            disabled={disabled}
          >
            Reset to default
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {effective.map((seg, idx) => {
          const startHole = idx * 6 + 1;
          const endHole = startHole + 5;
          const aPairKey = [...seg.team_a].sort().join("|");
          return (
            <li
              key={idx}
              className="rounded-lg bg-brand-900/30 p-2.5 space-y-2"
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider text-cream-100/55">
                  Seg {idx + 1} · holes {startHole}–{endHole}
                </span>
                <span className="text-[11px] text-cream-100/55">
                  Side B (auto):{" "}
                  <span className="text-cream-100/85">
                    {seg.team_b.map((id) => nameById.get(id)).join(" + ")}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-cream-100/65 shrink-0">
                  Side A:
                </label>
                <select
                  className="input text-sm flex-1 min-w-0"
                  value={aPairKey}
                  onChange={(e) => {
                    const [a, b] = e.target.value.split("|") as [string, string];
                    setSegmentPair(idx, [a, b]);
                  }}
                  disabled={disabled}
                >
                  {allPairs.map((pair) => {
                    const key = [...pair].sort().join("|");
                    const labelA = nameById.get(pair[0]) ?? "Player";
                    const labelB = nameById.get(pair[1]) ?? "Player";
                    return (
                      <option key={key} value={key}>
                        {labelA} + {labelB}
                      </option>
                    );
                  })}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      {pairsDuplicate && (
        <p className="text-[11px] text-amber-200 leading-snug">
          Heads up: the same pair plays together in more than one segment.
          That&apos;s legal but means one partnership repeats and another
          never forms — most groups pick three different pairings.
        </p>
      )}
    </div>
  );
}

/**
 * AddGameForm — family-first picker.
 *
 * Step 1: pick a family (Individual / Best ball / Aggregate / Scramble /
 *         Skins / Nassau / 6–6–6 / Side bets).
 * Step 2: if the family has multiple variants, pick one (defaults set).
 *         If the family has gross/net mode, show the radio.
 * Step 3: name + stake (or "each skin"/Nassau-special UI).
 *
 * Resolves to a concrete GameType via family.variants[i].resolve(mode)
 * before insert.
 */
function AddGameForm({
  existing,
  onCancel,
  onAdd,
  busy
}: {
  existing: Game[];
  onCancel: () => void;
  onAdd: (payload: {
    game_type: GameType;
    name: string;
    stake_cents: number;
    allowance_pct: number;
    config: Record<string, unknown>;
  }) => void;
  busy: boolean;
}) {
  const [familyKey, setFamilyKey] = useState<string>("");
  const family = familyKey ? getFamily(familyKey) : undefined;
  const [variantKey, setVariantKey] = useState<string>("");
  const variant = useMemo(
    () => family?.variants.find((v) => v.key === variantKey),
    [family, variantKey]
  );
  const [mode, setMode] = useState<"gross" | "net">("net");
  const [name, setName] = useState("");
  const [stake, setStake] = useState<number>(0);

  // Resolve the concrete game_type the user has currently configured (or null).
  const resolved = useMemo<GameType | null>(() => {
    if (!variant) return null;
    return variant.resolve(family?.hasMode ? mode : null);
  }, [variant, family, mode]);
  const resolvedPreset = resolved ? getPreset(resolved) : undefined;

  // Choose a suggested name + default stake whenever family/variant/mode shifts.
  function autofill(nextFamily: GameFamily, nextVariantKey: string, nextMode: "gross" | "net") {
    const v = nextFamily.variants.find((x) => x.key === nextVariantKey);
    if (!v) return;
    const t = v.resolve(nextFamily.hasMode ? nextMode : null);
    const p = getPreset(t);
    const baseLabel = nextFamily.hasMode ? `${nextFamily.label} (${nextMode})` : v.label;
    const taken = existing.some((g) => g.name === baseLabel);
    setName(taken ? `${baseLabel} #${existing.length + 1}` : baseLabel);
    if (t.startsWith("skins") || t === "skins_canadian") {
      // Skins default to pot-based with $20 buy-in.
      setStake(((p?.defaults.config as any)?.buyin_cents ?? 2000) / 100);
    } else if (p?.defaults.stake_cents) {
      setStake(p.defaults.stake_cents / 100);
    } else {
      setStake(0);
    }
  }

  function pickFamily(key: string) {
    setFamilyKey(key);
    const f = getFamily(key);
    if (!f) return;
    const v = f.defaultVariant;
    const m = f.defaultMode ?? "net";
    setVariantKey(v);
    setMode(m);
    autofill(f, v, m);
  }

  const isSkinsFamily = familyKey === "skins";
  const isNassauFamily = familyKey === "nassau";
  // For "side bets" → CTP/long_drive/custom — a stake field still applies.
  const stakeIsSkin = isSkinsFamily;

  return (
    <div className="card p-4 space-y-3 border border-gold-500/30">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-cream-50">Add a game</h2>
        <button
          type="button"
          className="btn-ghost text-xs text-cream-100/65"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      <div>
        <label className="label">Game</label>
        <select
          className="input"
          value={familyKey}
          onChange={(e) => pickFamily(e.target.value)}
        >
          <option value="">— Pick a game —</option>
          {GAME_FAMILIES.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        {family && <p className="text-xs text-cream-100/55 mt-1">{family.short}</p>}
      </div>

      {family && family.variants.length > 1 && (
        <div>
          <label className="label">Variant</label>
          <div className="flex flex-wrap gap-2">
            {family.variants.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => {
                  setVariantKey(v.key);
                  autofill(family, v.key, mode);
                }}
                className={`pill text-xs px-3 py-1.5 ${
                  variantKey === v.key
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {variant && <p className="text-xs text-cream-100/55 mt-1">{variant.short}</p>}
        </div>
      )}

      {family && family.hasMode && (
        <div>
          <label className="label">Mode</label>
          <div className="flex gap-2">
            {(["gross", "net"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  if (family) autofill(family, variantKey, m);
                }}
                className={`pill text-xs px-3 py-1.5 capitalize ${
                  mode === m
                    ? "bg-gold-500 text-brand-900"
                    : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            <span className="text-cream-100/65">Gross</span> uses raw scores.{" "}
            <span className="text-cream-100/65">Net</span> applies handicaps so
            higher-handicap players are competitive.
          </p>
        </div>
      )}

      {family && variant && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Display name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {!isNassauFamily && (
              <div>
                <label className="label">
                  {stakeIsSkin ? "Buy-in per player (USD)" : "Stake (USD)"}
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.50"
                  min={0}
                  defaultValue={stake}
                  onBlur={(e) => setStake(parseFloat(e.target.value) || 0)}
                />
                {stakeIsSkin && (
                  <p className="text-[10px] text-cream-100/45 mt-0.5">
                    Pot-based by default — pot is divided equally among won
                    skins. Switch to fixed-value after adding if you prefer.
                  </p>
                )}
              </div>
            )}
          </div>
          {isNassauFamily && (
            <p className="text-[11px] text-cream-100/55">
              Set the front 9 / back 9 / overall stakes after adding — Nassau
              has three side bets that you can configure independently.
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !name || !resolved}
            onClick={() => {
              if (!resolved || !resolvedPreset) return;
              const cents = Math.round(stake * 100);
              let config: Record<string, unknown> = { ...resolvedPreset.defaults.config };
              let stake_cents = resolvedPreset.defaults.stake_cents;
              if (stakeIsSkin) {
                // Pot-based default: write buyin_cents (preset config already
                // sets skin_mode: "pot"). User can switch to fixed mode later.
                config = { ...config, buyin_cents: cents };
                stake_cents = 0;
              } else if (!isNassauFamily) {
                stake_cents = cents;
              }
              onAdd({
                game_type: resolved,
                name,
                stake_cents,
                allowance_pct: resolvedPreset.defaults.allowance_pct,
                config
              });
            }}
          >
            {busy ? "Adding…" : "Add game"}
          </button>
        </>
      )}
    </div>
  );
}
