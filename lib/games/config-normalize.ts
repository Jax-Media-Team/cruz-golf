/**
 * Game-config legacy-shape rescuer.
 *
 * Patrick 2026-05-13: "2-down auto presses are not working properly."
 *
 * Root cause (diagnosed by a focused agent): the round-creation UI
 * was writing `presses_enabled: true` (boolean) on Nassau / team-match
 * / 6-6-6 configs for months, but the settlement + live-state engines
 * only read `cfg.presses === "auto_2_down"` (string enum). Every
 * round created via the Suggested-Nassau package or the live games-
 * editor checkbox had `presses_enabled: true` AND `presses === undefined`,
 * so the engine silently saw "no presses" and never opened the chain.
 *
 * The UI writes have been fixed at the source (game-packages.ts,
 * library.ts defaults, games-editor.tsx NassauConfig). But existing
 * in-flight rounds in the DB still carry the legacy boolean — we
 * can't ask Patrick to walk every round commissioner through a
 * "re-save your games" flow. This helper rescues them.
 *
 * Call once at every engine entry point (`settleGame`, `buildLiveMatchState`)
 * to coerce the config into the canonical shape before any read.
 *
 * Idempotent — a config already on the new shape passes through
 * unchanged.
 */

type AnyConfig = Record<string, any> | null | undefined;

export function normalizeGameConfig<T extends AnyConfig>(cfg: T): T {
  if (!cfg) return cfg;
  // Already on the new shape — nothing to do.
  if ((cfg as any).presses != null) return cfg;
  // Legacy boolean was set true — coerce to "auto_2_down".
  if ((cfg as any).presses_enabled === true) {
    return { ...cfg, presses: "auto_2_down" } as T;
  }
  // Legacy boolean was set false (or never set) — coerce to "none".
  // We don't WRITE "none" back to the DB; we just give the engine a
  // value it can compare against without falling through to undefined.
  if ((cfg as any).presses_enabled === false) {
    return { ...cfg, presses: "none" } as T;
  }
  return cfg;
}

/**
 * Predicate for "is auto-press at 2-down enabled?" — call sites that
 * just need the boolean check without the full normalize allocation.
 */
export function isAutoPress2Down(cfg: AnyConfig): boolean {
  if (!cfg) return false;
  const p = (cfg as any).presses;
  if (p === "auto_2_down") return true;
  if (p == null && (cfg as any).presses_enabled === true) return true;
  return false;
}
