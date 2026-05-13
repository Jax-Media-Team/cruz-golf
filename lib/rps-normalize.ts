/**
 * Shared shape-normalization helpers for `round_players` query results.
 *
 * BACKGROUND (Patrick 2026-05-13, "leaderboard gross/net not populating"):
 *
 * PostgREST returns nested embeds as objects when the relationship is
 * unambiguous (1-to-1) and as arrays when it's ambiguous (1-to-many).
 * `round_players → course_tees` is a 1-to-1 FK via `round_players.tee_id`,
 * but adding `course_tees(id, ...)` to the select sometimes flips
 * PostgREST's inference because `course_tees` ALSO has a back-pointer
 * via `course_tees.course_id → courses.id → rounds.course_id` — and
 * the inference is sensitive to the column list.
 *
 * Empirically, the live-round detail page started getting back
 * `course_tees: [{...}]` instead of `course_tees: {...}` after the
 * recent rps-shape refactor. Downstream code (round-view.tsx,
 * finalize-view.tsx, lib/scoring.ts) reads `r.course_tees?.course_holes`
 * which silently returns `undefined` on an array, gutting the
 * leaderboard.
 *
 * The fix lives here so every page that fetches rps with `course_tees`
 * goes through the same defensive unwrap. If a future query ALSO trips
 * PostgREST's inference on a different embed, this is the single place
 * to add another normalizer.
 */

type AnyRP = Record<string, any>;

/**
 * Defensively unwrap `course_tees` to a single object. PostgREST may
 * return it as a one-element array when the relationship is ambiguous.
 *
 * Selection rule when an array is returned:
 *   1. If any element's `id` matches `round_players.tee_id`, pick that.
 *   2. Otherwise pick the first element.
 *   3. If the array is empty, return `null`.
 */
export function normalizeCourseTees(rp: AnyRP): AnyRP {
  const tees = rp.course_tees;
  if (!Array.isArray(tees)) return rp; // already a single object (or null)
  const matched = rp.tee_id ? tees.find((t) => t?.id === rp.tee_id) : null;
  const next = matched ?? tees[0] ?? null;
  return { ...rp, course_tees: next };
}

/**
 * Normalize an array of round_players results. Idempotent — safe to
 * call on already-normalized rps.
 */
export function normalizeRps<T extends AnyRP>(rps: T[] | null | undefined): T[] {
  if (!rps) return [];
  return rps.map((r) => normalizeCourseTees(r) as T);
}
