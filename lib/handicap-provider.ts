/**
 * Handicap-provider abstraction.
 *
 * Phase 1 (today): the app stores `handicap_index` on each player as a
 *   manually-entered number, plus an optional `ghin_number` for
 *   reference. There is no automated lookup.
 *
 * Phase 2 (later): an official USGA/GHIN partnership becomes possible,
 *   or another source of trusted indexes emerges (USHandicap, Arccos,
 *   etc.). When that happens, we want to layer the new data source IN
 *   without rewriting every player flow.
 *
 * This file is the seam.
 *
 * Per Patrick (2026-05-10): "GHIN should eventually become 'one trusted
 * data source feeding the golf-group ecosystem' — not the only one, and
 * not a replacement for community/local data." So the design admits
 * multiple providers, layered overrides, and graceful fallbacks.
 *
 * Architectural rules baked in here:
 *
 *   1. Providers are pure functions of identity → handicap data. They
 *      don't know about Supabase, RLS, or React.
 *   2. Every handicap value carries provenance: which provider, when
 *      it was last fetched, and what level of trust it carries.
 *   3. Local overrides ALWAYS win. If a commissioner manually sets a
 *      player's handicap to 8.4, an official GHIN refresh of 7.9
 *      doesn't silently overwrite it — the override is preserved and
 *      the GHIN value is stored as a separate snapshot.
 *   4. A player can have a handicap with NO provider attached (the
 *      default for community-entered indexes) — that's fine, it's
 *      just unverified.
 *   5. Providers never run during the hot path of round creation or
 *      score entry. Lookups are always async + cached + non-blocking.
 *
 * Today there's a single placeholder provider — `manual` — that just
 * passes through whatever value is on the players row. That keeps the
 * existing UI working while making the seam visible. When GHIN/USGA
 * integration becomes possible, `ghinProvider` slots in alongside.
 */

// ---- Types -----------------------------------------------------------

export type HandicapProviderId =
  | "manual" // Hand-entered by a commissioner or the player themselves
  | "ghin" // Official USGA/GHIN (placeholder; not yet implemented)
  | "ushandicap" // Future: third-party services
  | "arccos"; // Future: third-party services

export type HandicapTrust =
  | "official" // From a recognized governing body (USGA/GHIN)
  | "community" // Hand-entered, peer-reviewed within a group
  | "self" // Hand-entered by the player themselves
  | "unverified"; // Default fallback

export type HandicapValue = {
  /** WHS Handicap Index, e.g. 7.9 or +1.4. Null when unknown. */
  index: number | null;
  /** Where this value came from. */
  provider: HandicapProviderId;
  /** How much we trust it. */
  trust: HandicapTrust;
  /** ISO timestamp the value was last fetched/entered. */
  fetched_at: string;
  /** Provider-specific identifier (GHIN number, etc.) when available. */
  external_id?: string | null;
};

export type HandicapProviderLookup = {
  /** Stable provider id. */
  id: HandicapProviderId;
  /** Display name shown in UI. */
  label: string;
  /** Trust level emitted by this provider. */
  trust: HandicapTrust;
  /**
   * Look up a player's handicap from this provider.
   *
   * Implementations should:
   *   - Be idempotent and side-effect-free (caching is fine, mutation isn't)
   *   - Return null when the player isn't found (don't throw)
   *   - Throw only on transport / auth errors
   *   - Honor a 5s soft timeout — callers will surface "couldn't refresh"
   *     UX rather than block on slow third-parties
   */
  lookup(opts: {
    /** Provider-specific id (GHIN number, email, etc.). */
    externalId: string;
    /** Optional context the provider may use for additional confidence. */
    fullName?: string;
    homeClub?: string;
  }): Promise<HandicapValue | null>;
};

// ---- Built-in providers ----------------------------------------------

/**
 * Manual provider — the default for everything today. Just echoes back
 * whatever index was passed in as a HandicapValue with `community` trust.
 *
 * Used by the players page when a commissioner types in 7.9 — we wrap
 * the bare number in the provenance envelope so downstream code doesn't
 * have to special-case "no provider."
 */
export const manualProvider: HandicapProviderLookup = {
  id: "manual",
  label: "Hand-entered",
  trust: "community",
  async lookup() {
    // Manual provider has no external lookup; callers construct values
    // directly via `wrapManualIndex` below.
    return null;
  }
};

/**
 * GHIN provider — placeholder. Returns null for every lookup until an
 * official USGA/GHIN integration is in place. Keeping the shape here
 * means UI can already reference `ghinProvider.label` ("Official GHIN")
 * without conditional imports. When we light up real GHIN, only this
 * file changes.
 */
export const ghinProvider: HandicapProviderLookup = {
  id: "ghin",
  label: "Official GHIN",
  trust: "official",
  async lookup() {
    // Not implemented. Returns null so the UI shows
    // "Couldn't fetch from GHIN — using your manual index" rather than
    // failing hard.
    return null;
  }
};

export const PROVIDERS: Record<HandicapProviderId, HandicapProviderLookup> = {
  manual: manualProvider,
  ghin: ghinProvider,
  // Future provider slots — the same shape, layered in here when they
  // become real. Nothing else in the app needs to change.
  ushandicap: { ...manualProvider, id: "ushandicap", label: "USHandicap" },
  arccos: { ...manualProvider, id: "arccos", label: "Arccos" }
};

// ---- Helpers ---------------------------------------------------------

/**
 * Wrap a bare manually-entered index in the provenance envelope. Used
 * everywhere we read `players.handicap_index` from the database.
 */
export function wrapManualIndex(
  index: number | null,
  ghinNumber?: string | null
): HandicapValue {
  return {
    index,
    provider: "manual",
    trust: ghinNumber ? "self" : "community",
    fetched_at: new Date().toISOString(),
    external_id: ghinNumber ?? null
  };
}

/**
 * Resolve a player's effective handicap given:
 *   - the local stored value (always)
 *   - any official-provider snapshot we cached (optional)
 *   - the override flag (whether the local value was hand-set after
 *     an official refresh)
 *
 * Local overrides always win. This is the rule that makes layered
 * providers safe — official integrations can't silently change a
 * group's negotiated handicap.
 */
export function resolveEffectiveHandicap(input: {
  local: HandicapValue;
  official?: HandicapValue | null;
  /** True when the local value was set AFTER the latest official fetch
   *  (an explicit override). False/undefined when the local value is
   *  just a stale copy of the official one. */
  override?: boolean;
}): HandicapValue {
  if (input.override) return input.local;
  // No override: prefer the official value when present and fresher.
  if (input.official?.index != null) {
    if (input.local.fetched_at < input.official.fetched_at) {
      return input.official;
    }
  }
  return input.local;
}

/**
 * UX label for showing trust level next to a handicap. Tone discipline
 * carries over — no fire emoji, no "VERIFIED!!!", just understated copy.
 */
export function trustLabel(trust: HandicapTrust): string {
  switch (trust) {
    case "official":
      return "Official";
    case "community":
      return "Hand-entered";
    case "self":
      return "Self-reported";
    case "unverified":
    default:
      return "Unverified";
  }
}

// ---- Future-proofing the schema (notes for future migration) ----------

/**
 * When official integrations land, we'll add columns to `players`:
 *
 *   handicap_provider           text     default 'manual'
 *   handicap_external_id        text     -- GHIN number, etc.
 *   handicap_fetched_at         timestamptz
 *   handicap_official_index     numeric  -- last official snapshot
 *   handicap_official_fetched   timestamptz
 *   handicap_local_overrides    boolean  -- explicit override flag
 *
 * The existing `handicap_index` + `ghin_number` columns stay; new
 * columns layer in as additive metadata. RLS doesn't change.
 *
 * The seam in this file means the player UI, score-entry flow, and
 * leaderboard math all keep working without conditional logic — they
 * just consume `HandicapValue` objects from `resolveEffectiveHandicap`
 * instead of bare numbers.
 */
