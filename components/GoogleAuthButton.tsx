"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

/**
 * Google OAuth sign-in. The button is GATED behind an explicit env
 * flag (`NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true`) because the actual
 * OAuth provider has to be configured in the Supabase dashboard
 * BEFORE clicking the button works. Otherwise Supabase 400s with
 * "Unsupported provider: provider is not enabled" and the user lands
 * on a raw JSON error page (the Supabase auth URL itself).
 *
 * To turn this back on: configure the Google provider in Supabase
 * Dashboard → Authentication → Providers, then set
 * NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true on Vercel.
 *
 * Patrick 2026-05-12: "the facebook and google login options both
 * throw an error" — confirmed neither provider was configured, so
 * the buttons must hide.
 */
const ENABLED = process.env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED === "true";

export function GoogleAuthButton({ next = "/dashboard" }: { next?: string }) {
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!ENABLED) return null;

  async function go() {
    setBusy(true);
    setErr(null);
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        : undefined;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) {
      setBusy(false);
      setErr(friendlyAuthError(error));
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={busy}
        onClick={go}
        aria-label="Continue with Google"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#EA4335" d="M12 11v3.2h7.5c-.3 1.7-2.2 5-7.5 5-4.5 0-8.2-3.7-8.2-8.2S7.5 2.8 12 2.8c2.6 0 4.3 1.1 5.3 2l3.6-3.5C18.5.6 15.5-.5 12-.5 5.4-.5 0 4.9 0 11.5S5.4 23.5 12 23.5c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2H12z"/>
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {err && <p className="text-xs text-red-300 text-center">{err}</p>}
    </div>
  );
}
