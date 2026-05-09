/**
 * Translate raw Supabase / Postgres errors into messages we'd say to a golfer.
 * Never show stack traces, schema-cache complaints, or RLS policy names to users.
 */
export function friendlyAuthError(raw: unknown): string {
  const msg =
    typeof raw === "string"
      ? raw
      : (raw as { message?: string })?.message ?? "";
  const lower = msg.toLowerCase();

  // Schema cache issues — happens right after a fresh migration before PostgREST refreshes.
  if (lower.includes("schema cache") || lower.includes("could not find the table")) {
    return "Server is still warming up. Wait 30 seconds and try again.";
  }

  // Auth-specific
  if (lower.includes("invalid login credentials")) return "Wrong email or password.";
  if (lower.includes("email not confirmed"))
    return "Check your inbox for the confirmation email — we sent a link.";
  if (lower.includes("user already registered") || lower.includes("already exists"))
    return "An account with that email already exists. Try signing in instead.";
  if (lower.includes("email rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (lower.includes("password should be"))
    return "Password needs to be at least 8 characters.";

  // RLS / Postgres errors
  if (lower.includes("row-level security") || lower.includes("violates row-level"))
    return "Something on our side blocked that. Refresh and try again, or tell Cruz.";
  if (lower.includes("duplicate key") || lower.includes("unique constraint"))
    return "Looks like that already exists.";
  if (lower.includes("foreign key"))
    return "Linked record is missing. Refresh and try again.";

  // Network
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("timeout"))
    return "Network hiccup. Check your connection and retry.";

  // Fallback — generic, never expose internals
  if (msg.length > 0 && msg.length < 120 && !lower.includes("postgres") && !lower.includes("pgrst"))
    return msg; // short, non-technical message — pass through

  return "Something went sideways. Try again, or tell Cruz so he can check.";
}
