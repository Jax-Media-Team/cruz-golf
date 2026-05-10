/**
 * Date/time formatting that respects the user's local timezone.
 *
 * Server components run on Vercel where `new Date().toLocaleString()`
 * defaults to UTC, which made every timestamp show in the future for
 * any user east of UTC (e.g., Eastern users got their 9 AM round
 * displayed as "1 PM"). This helper pins the format to the requested
 * timezone — defaulting to Eastern (`America/New_York`) since that's
 * where the Cruz Golf user base lives today.
 *
 * Long term: read `users.timezone` (TBD) per request and pass through.
 */
const DEFAULT_TZ = "America/New_York";

export function formatDate(
  input: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
  timeZone: string = DEFAULT_TZ
): string {
  if (input == null) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts
  }).format(d);
}

export function formatDateTime(
  input: Date | string | number | null | undefined,
  timeZone: string = DEFAULT_TZ
): string {
  return formatDate(input, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }, timeZone);
}

/** "May 9" style. */
export function formatShortDate(
  input: Date | string | number | null | undefined,
  timeZone: string = DEFAULT_TZ
): string {
  return formatDate(input, { month: "short", day: "numeric" }, timeZone);
}

/** Pure date (YYYY-MM-DD) → "May 9, 2026" without time component. */
export function formatRoundDate(
  input: Date | string | number | null | undefined,
  timeZone: string = DEFAULT_TZ
): string {
  if (input == null) return "";
  // Round dates are stored as DATE (no time). When parsed by JS as ISO with
  // no offset, the engine assumes UTC midnight, then converting to Eastern
  // shifts it back a day. Detect the YYYY-MM-DD shape and format directly.
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC = same day everywhere
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(dt);
  }
  return formatDate(input, { year: "numeric", month: "short", day: "numeric" }, timeZone);
}
