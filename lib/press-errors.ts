/**
 * Friendly error messages for press RPC failures.
 *
 * Press accept / decline / withdraw / open are non-queueable (the 24h
 * expiry window matters + server enforces business rules like "only
 * side B can accept"). When the RPC fails after retry, we surface a
 * message that explains what to do next instead of the raw Supabase
 * error.
 *
 * Pure function — `navigator.onLine` is read lazily inside so the
 * helper can be unit-tested by stubbing the global.
 */

type OnlineGetter = () => boolean;

export function pressErrorMessage(
  err: unknown,
  isOnline: OnlineGetter = () =>
    typeof navigator === "undefined" ? true : navigator.onLine
): string {
  // Extract a usable string. Three cases: Error-like with `.message`,
  // raw string, or anything else (null / undefined / plain object) →
  // empty string, which triggers the generic fallback below.
  let raw: string;
  if (err && typeof err === "object" && "message" in err) {
    raw = String((err as { message?: unknown }).message ?? "");
  } else if (typeof err === "string") {
    raw = err;
  } else {
    raw = "";
  }
  const lower = raw.toLowerCase();

  // Offline trumps everything — even a Postgres error message means
  // very little to a user whose phone has no signal.
  if (!isOnline()) {
    return "You're offline. Try again when you reconnect.";
  }

  if (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("aborted") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout")
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  // Pass through Postgres error messages — these are typically
  // business-rule failures from the RPC ("Press not pending", "Only
  // side B can accept", etc.) and are already plain English.
  return raw || "Something went wrong. Try again.";
}
