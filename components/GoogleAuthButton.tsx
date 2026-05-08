"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function GoogleAuthButton({ next = "/dashboard" }: { next?: string }) {
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      setErr(error.message);
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
