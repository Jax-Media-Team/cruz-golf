"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GAME_LIBRARY, getPreset, type GamePreset } from "@/lib/games/library";
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

  async function addGame(preset: GamePreset, overrides: Partial<Game>) {
    setBusy(true);
    setErr(null);
    const payload = {
      round_id: roundId,
      game_type: preset.game_type,
      name: overrides.name || preset.label,
      stake_cents: overrides.stake_cents ?? preset.defaults.stake_cents,
      allowance_pct: overrides.allowance_pct ?? preset.defaults.allowance_pct,
      config: overrides.config ?? preset.defaults.config
    };
    const { data, error } = await sb
      .from("round_games")
      .insert(payload)
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
              {isSkins ? "Pot per skin (USD)" : "Stake (USD)"}
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

function AddGameForm({
  existing,
  onCancel,
  onAdd,
  busy
}: {
  existing: Game[];
  onCancel: () => void;
  onAdd: (preset: GamePreset, overrides: Partial<Game>) => void;
  busy: boolean;
}) {
  const [pickedType, setPickedType] = useState<GameType | "">("");
  const preset = pickedType ? getPreset(pickedType) : undefined;
  const [name, setName] = useState("");
  const [stake, setStake] = useState<number>(0);

  function applyPreset(t: GameType) {
    setPickedType(t);
    const p = getPreset(t);
    if (!p) return;
    // Suggest a unique-ish name when adding a duplicate game.
    const baseName = p.label;
    const taken = existing.some((g) => g.name === baseName);
    setName(taken ? `${baseName} #${existing.length + 1}` : baseName);
    setStake(p.defaults.stake_cents / 100);
  }

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
        <label className="label">Game type</label>
        <select
          className="input"
          value={pickedType}
          onChange={(e) => applyPreset(e.target.value as GameType)}
        >
          <option value="">— Pick a game —</option>
          {GAME_LIBRARY.map((g) => (
            <option key={g.game_type} value={g.game_type}>
              {g.label}
            </option>
          ))}
        </select>
        {preset && <p className="text-xs text-cream-100/55 mt-1">{preset.short}</p>}
      </div>
      {preset && (
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
            {preset.game_type !== "nassau" && (
              <div>
                <label className="label">
                  {preset.game_type.startsWith("skins") ? "Pot per skin (USD)" : "Stake (USD)"}
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.50"
                  min={0}
                  value={stake}
                  onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !name}
            onClick={() => {
              const cents = Math.round(stake * 100);
              const overrides: Partial<Game> = { name };
              if (preset.game_type.startsWith("skins")) {
                overrides.config = { ...(preset.defaults.config ?? {}), skin_value_cents: cents };
                overrides.stake_cents = 0;
              } else if (preset.game_type !== "nassau") {
                overrides.stake_cents = cents;
              }
              onAdd(preset, overrides);
            }}
          >
            {busy ? "Adding…" : "Add game"}
          </button>
        </>
      )}
    </div>
  );
}
