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
        {!isNassau && (
          <div>
            <label className="label">
              {isSkins ? "Each skin (USD)" : "Stake (USD)"}
            </label>
            <input
              className="input"
              type="number"
              step="0.50"
              min={0}
              value={
                isSkins
                  ? ((game.config?.skin_value_cents as number) ?? 0) / 100
                  : game.stake_cents / 100
              }
              onChange={(e) => {
                const dollars = parseFloat(e.target.value);
                const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
                if (isSkins) {
                  onPatch({
                    config: { ...(game.config ?? {}), skin_value_cents: cents }
                  });
                } else {
                  onPatch({ stake_cents: cents });
                }
              }}
              disabled={disabled}
            />
            {isSkins && (
              <p className="text-[10px] text-cream-100/45 mt-0.5">
                What each skin pays out. Total pot scales with how many skins
                are won (max 18).
              </p>
            )}
          </div>
        )}
        <div>
          <label className="label">Allowance %</label>
          <input
            className="input"
            type="number"
            min={0}
            max={150}
            value={game.allowance_pct}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onPatch({ allowance_pct: Number.isFinite(v) ? v : 100 });
            }}
            disabled={disabled}
          />
          <p className="text-[10px] text-cream-100/45 mt-0.5">
            WHS: 100 = full strokes, 85 = match-play scaled.
          </p>
        </div>
      </div>

      {isNassau && <NassauConfig game={game} disabled={disabled} onPatch={onPatch} />}

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
    if (p?.defaults.stake_cents) setStake(p.defaults.stake_cents / 100);
    else if (t === "skins_canadian" || t.startsWith("skins"))
      setStake(((p?.defaults.config as any)?.skin_value_cents ?? 200) / 100);
    else setStake(0);
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
                  {stakeIsSkin ? "Each skin (USD)" : "Stake (USD)"}
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.50"
                  min={0}
                  value={stake}
                  onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                />
                {stakeIsSkin && (
                  <p className="text-[10px] text-cream-100/45 mt-0.5">
                    What each skin pays out. Total pot scales with how many
                    skins are won (max 18).
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
                config = { ...config, skin_value_cents: cents };
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
