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
import type { GameType } from "@/lib/types";

type Game = {
  id: string;
  game_type: GameType;
  name: string;
  stake_cents: number;
  allowance_pct: number;
  config: Record<string, unknown>;
};

export function GamesEditor({
  roundId,
  initialGames,
  hasScores
}: {
  roundId: string;
  initialGames: Game[];
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
    </div>
  );
}

function GameCard({
  game,
  disabled,
  onPatch,
  onRemove
}: {
  game: Game;
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
      {isTeamGame && <TeamMatchPlayConfig game={game} disabled={disabled} onPatch={onPatch} />}

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
  disabled,
  onPatch
}: {
  game: Game;
  disabled: boolean;
  onPatch: (patch: Partial<Game>) => void;
}) {
  const c = (game.config ?? {}) as Record<string, unknown>;
  const matchPlay = c.match_play === true;
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
