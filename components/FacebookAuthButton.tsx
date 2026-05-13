"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

/**
 * Facebook OAuth sign-in via Supabase. Mirrors GoogleAuthButton.
 *
 * GATED behind `NEXT_PUBLIC_OAUTH_FACEBOOK_ENABLED=true`. Clicking
 * the button when the provider isn't configured in Supabase drops
 * the user on a raw JSON error page at the Supabase auth URL —
 * Patrick saw exactly this on 2026-05-12 ("the facebook and google
 * login options both throw an error"). Hiding the button until the
 * provider is wired up is the only honest UX.
 *
 * To enable: configure Facebook in Supabase Dashboard → Authentication
 * → Providers (see docs/FACEBOOK_AUTH_SETUP.md for the Meta-side
 * setup), then set NEXT_PUBLIC_OAUTH_FACEBOOK_ENABLED=true on Vercel.
 */
const ENABLED = process.env.NEXT_PUBLIC_OAUTH_FACEBOOK_ENABLED === "true";

export function FacebookAuthButton({ next = "/dashboard" }: { next?: string }) {
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
    // Supabase's Facebook provider grabs `email` + `public_profile`
    // by default. `public_profile` includes a profile picture URL
    // which lands on the user_metadata.avatar_url claim — used
    // later for round-leaderboard avatars and player headshots.
    const { error } = await sb.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo }
    });
    if (error) {
      setBusy(false);
      // "Unsupported provider" surfaces when the Facebook provider
      // isn't configured in the Supabase dashboard. friendlyAuthError
      // surfaces that as-is; the message itself is plain English.
      setErr(friendlyAuthError(error));
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary w-full inline-flex items-center justify-center gap-2"
        disabled={busy}
        onClick={go}
        aria-label="Continue with Facebook"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path
            fill="#1877F2"
            d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.017 1.792-4.687 4.533-4.687 1.312 0 2.686.236 2.686.236v2.972h-1.514c-1.49 0-1.955.93-1.955 1.886v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
          />
        </svg>
        {busy ? "Opening Facebook…" : "Continue with Facebook"}
      </button>
      {err && <p className="text-xs text-red-300 text-center">{err}</p>}
    </div>
  );
}
