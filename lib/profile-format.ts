/**
 * Pure helpers for player-profile fields (Venmo handle, Instagram handle,
 * X handle, website URL) and the Venmo deep-link URL builder used by the
 * finalize flow + the persistent SettlementSummary on the round page.
 *
 * Extracted from inline duplicates across:
 *   - app/(app)/players/[id]/stats/profile-editor.tsx (cleanHandle, cleanUrl)
 *   - components/SettlementSummary.tsx (cleanHandle, venmoPayUrl, note builder)
 *   - app/(app)/rounds/[id]/finalize/finalize-view.tsx (cleanHandle, venmoPayUrl, note builder)
 *
 * Centralizing means a single regression-tested source of truth, and a
 * single place to fix when (e.g.) the Venmo URL params shift.
 */

/**
 * Normalize a social handle: strip leading "@" symbols plus surrounding
 * whitespace from both ends. Returns null when the result is empty.
 *
 * Mirrors the DB trigger in migration 0046
 * (`tf_players_trim_socials`), which calls `btrim(value, ' @')` so
 * direct SQL inserts behave the same way. We use a regex equivalent
 * here that also strips tabs / newlines defensively (a stray paste
 * shouldn't slip past the trim).
 *
 * Idempotent — `cleanHandle(cleanHandle(x)) === cleanHandle(x)` for
 * all x. The earlier `.replace(/^@/, "").trim()` implementation
 * stripped only ONE leading @ and did so AFTER reading whitespace,
 * which broke on inputs like "\t@cruzgolfer\n" (left "@cruzgolfer")
 * and "@@@cruzgolfer" (left "@@cruzgolfer" on first pass, only
 * collapsed across two calls). The new btrim-style regex handles
 * both in one pass.
 */
export function cleanHandle(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Strip any combination of whitespace + @ from BOTH ends, in one pass.
  const t = raw.replace(/^[\s@]+|[\s@]+$/g, "");
  return t.length === 0 ? null : t;
}

/**
 * Coerce a website URL to a usable form. The user might type
 * "example.com"; we prepend "https://" so the resulting href is a real
 * absolute URL. Empty → null.
 *
 * NOT idempotent across the bare→prefixed transformation:
 *   cleanUrl("example.com") === "https://example.com"
 *   cleanUrl("https://example.com") === "https://example.com"
 *   cleanUrl(cleanUrl("example.com")) === "https://example.com"
 *
 * The second application is a no-op because the first added the
 * protocol. The function is intentionally NOT a deep URL validator —
 * a typo like "ht!tp://" survives and renders as a broken link, which
 * is preferable to silently dropping the user's input.
 */
export function cleanUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/**
 * Build a Venmo universal-link URL that pre-fills the pay sheet.
 * On iOS Safari this hands off to the Venmo app via Universal Links;
 * on desktop it opens venmo.com/{handle} in the browser. The browser
 * URL still respects amount + note params for one-tap pay on web.
 *
 * `handle` should already be cleaned (no leading "@"). Pass through
 * `cleanHandle` first if you're not sure.
 *
 * `dollars` is in dollars (not cents) and rounded to 2 decimals for
 * Venmo's `amount` param.
 */
export function venmoPayUrl(
  handle: string,
  dollars: number,
  note: string
): string {
  const params = new URLSearchParams({
    txn: "pay",
    amount: dollars.toFixed(2),
    note
  });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}

/**
 * Compose the Venmo note for a Cruz Golf settlement transfer:
 *   "Cruz Golf · JGCC · May 12"
 * Falls back to "Cruz Golf" alone when course / date is missing.
 * Falls back to "Cruz Golf · JGCC" when course is set but date is bad.
 *
 * Locale-fixed (en-US) so the note text is stable across device
 * locales — the recipient sees the same string regardless of where
 * the payer is sending from.
 *
 * `roundDate` is the ISO date string from the rounds.date column
 * (YYYY-MM-DD). Parsed at noon UTC to avoid the timezone-shift bug
 * documented in lib/format-date.ts:formatRoundDate.
 */
export function venmoNoteForRound(
  courseName: string | null | undefined,
  roundDate: string | null | undefined
): string {
  const parts: string[] = ["Cruz Golf"];
  if (courseName && courseName.trim().length > 0) {
    parts.push(courseName.trim());
  }
  if (roundDate && /^\d{4}-\d{2}-\d{2}$/.test(roundDate)) {
    const [y, m, d] = roundDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (!isNaN(dt.getTime())) {
      parts.push(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC",
          month: "short",
          day: "numeric"
        }).format(dt)
      );
    }
  }
  return parts.join(" · ");
}
