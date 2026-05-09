"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

export function OnboardingForm({
  email,
  suggestedName
}: {
  email: string;
  suggestedName: string;
}) {
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("fn_bootstrap_account", {
      p_display_name: name,
      p_group_name: ""
    });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="max-w-md mx-auto py-6">
      <form onSubmit={submit} className="card p-7 space-y-5">
        <div>
          <p className="h-eyebrow">Finish setup</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">One more step</h1>
          <p className="text-xs text-cream-100/55 mt-1">
            Signed in as {email}. Tell us your name and you&apos;re in.
          </p>
        </div>
        <div>
          <label className="label">Your name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cruz"
            required
            autoFocus
          />
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Setting up…" : "Finish setup"}
        </button>
      </form>
    </main>
  );
}
