"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type EventGameRow = {
  id: string;
  game_type: string;
  name: string;
  stake_cents: number;
  allowance_pct: number;
};

// Only the game types the event engine actually settles field-wide.
// Nassau / 6-6-6 / team formats are deliberately omitted — they don't
// extend cleanly across foursomes without bracketing.
const FIELD_SUPPORTED = [
  { type: "skins_gross", label: "Skins (gross)", defaultStake: 500 },
  { type: "skins_net", label: "Skins (net)", defaultStake: 500 },
  { type: "individual_gross", label: "Stroke play (gross)", defaultStake: 2000 },
  { type: "individual_net", label: "Stroke play (net)", defaultStake: 2000 }
] as const;

/**
 * Inline event-games section. Commissioner-only. Lists existing
 * field-wide games + a small "+ Add field game" dialog.
 *
 * Field-wide here means the game settles across EVERY foursome in the
 * event (e.g. one skins pot for all 16 players). Per-foursome games
 * still live in /rounds/[id]/games — those are unchanged.
 */
export function EventGamesSection({
  eventId,
  isCommissioner,
  initialGames
}: {
  eventId: string;
  isCommissioner: boolean;
  initialGames: EventGameRow[];
}) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [games, setGames] = useState<EventGameRow[]>(initialGames);
  const [adding, setAdding] = useState(false);
  const [gameType, setGameType] = useState<string>(FIELD_SUPPORTED[0].type);
  const [stakeDollars, setStakeDollars] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function defaultLabel(type: string): string {
    return (
      FIELD_SUPPORTED.find((g) => g.type === type)?.label ??
      "Field game"
    );
  }

  async function addGame() {
    setBusy(true);
    setErr(null);
    const cfg = FIELD_SUPPORTED.find((g) => g.type === gameType);
    if (!cfg) {
      setErr("Pick a game type.");
      setBusy(false);
      return;
    }
    const { data, error } = await sb
      .from("event_games")
      .insert({
        event_id: eventId,
        game_type: gameType,
        name: cfg.label,
        stake_cents: Math.max(100, Math.round(stakeDollars * 100)),
        allowance_pct: gameType.endsWith("_net") ? 100 : 100,
        config: gameType.startsWith("skins")
          ? { carryover: true }
          : {},
        display_order: games.length
      })
      .select(
        "id, game_type, name, stake_cents, allowance_pct"
      )
      .single();
    setBusy(false);
    if (error || !data) {
      setErr(error?.message ?? "Couldn't add field game.");
      return;
    }
    setGames((prev) => [...prev, data as EventGameRow]);
    setAdding(false);
    router.refresh();
  }

  async function removeGame(id: string) {
    if (
      !confirm(
        "Remove this field game from the event? Any per-foursome games stay in place."
      )
    )
      return;
    const { error } = await sb
      .from("event_games")
      .delete()
      .eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    setGames((prev) => prev.filter((g) => g.id !== id));
    router.refresh();
  }

  if (games.length === 0 && !isCommissioner) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-serif text-xl text-cream-50">Field games</h2>
        {isCommissioner && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-xs"
          >
            + Add field game
          </button>
        )}
      </div>

      {games.length === 0 && !adding && (
        <div className="card p-3 text-xs text-cream-100/65">
          Field games settle across every foursome in the event — one
          pot for all players. Skins and stroke play supported today.
          Nassau / team formats stay per-foursome (no real golf-group
          press crosses foursomes).
        </div>
      )}

      {games.length > 0 && (
        <ul className="space-y-1.5">
          {games.map((g) => (
            <li
              key={g.id}
              className="card p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-cream-50 font-medium truncate">
                  {g.name}
                </div>
                <p className="text-[11px] text-cream-100/55 mt-0.5">
                  Field-wide · ${(g.stake_cents / 100).toFixed(2)}
                  {g.allowance_pct !== 100 && ` · ${g.allowance_pct}%`}
                </p>
              </div>
              {isCommissioner && (
                <button
                  type="button"
                  onClick={() => removeGame(g.id)}
                  className="btn-ghost text-xs text-red-300 shrink-0"
                  aria-label={`Remove ${g.name}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="card p-4 border border-gold-500/40 bg-brand-900/40 space-y-3">
          <div className="flex items-center justify-between">
            <p className="h-eyebrow text-gold-400">Field game</p>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setErr(null);
              }}
              className="btn-ghost text-xs"
            >
              Cancel
            </button>
          </div>
          <div>
            <label className="label text-xs">Format</label>
            <select
              className="input text-sm"
              value={gameType}
              onChange={(e) => {
                setGameType(e.target.value);
                const cfg = FIELD_SUPPORTED.find(
                  (g) => g.type === e.target.value
                );
                if (cfg) setStakeDollars(cfg.defaultStake / 100);
              }}
            >
              {FIELD_SUPPORTED.map((g) => (
                <option key={g.type} value={g.type}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label text-xs">
              Stake (USD per player per pot)
            </label>
            <input
              type="number"
              className="input text-sm"
              min={1}
              step={1}
              value={stakeDollars}
              onChange={(e) =>
                setStakeDollars(parseInt(e.target.value, 10) || 0)
              }
            />
            <p className="text-[11px] text-cream-100/55 mt-1 leading-snug">
              {gameType.startsWith("skins")
                ? "Per skin. Ties carry by default."
                : "Per player. Lowest field total wins."}
            </p>
          </div>
          {err && <p className="text-xs text-red-300">{err}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addGame}
              disabled={busy}
              className="btn-primary text-sm"
            >
              {busy ? "Adding…" : `Add ${defaultLabel(gameType)}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
