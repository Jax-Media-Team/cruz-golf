"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BrandLockup } from "@/components/BrandLockup";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { friendlyAuthError } from "@/lib/auth-errors";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const sb = supabaseBrowser();

    // emailRedirectTo lands the user on /auth/callback after they click the
    // confirmation link, where exchangeCodeForSession + the bootstrap will
    // run. Without this, the link redirects to Site URL with no session
    // exchange and onboarding never runs.
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=/onboarding`
        : undefined;
    const { data: signup, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { full_name: name } // persisted to user_metadata; /onboarding picks this up
      }
    });
    if (error || !signup.user) {
      setBusy(false);
      setErr(friendlyAuthError(error ?? "Sign-up failed"));
      return;
    }

    // If email confirmation is on, signUp returns user but no session. Show a
    // dedicated success panel — using the err state here was confusing because
    // it rendered in red.
    if (!signup.session) {
      setBusy(false);
      setConfirmedEmail(email);
      return;
    }

    const { error: bsErr } = await sb.rpc("fn_bootstrap_account", {
      p_display_name: name,
      p_group_name: ""
    });
    if (bsErr) {
      setBusy(false);
      setErr(friendlyAuthError(bsErr));
      return;
    }

    setBusy(false);
    router.push("/dashboard");
  }

  if (confirmedEmail) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
        <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
        <div className="card p-7 w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/40 flex items-center justify-center text-emerald-300 text-2xl">
            ✓
          </div>
          <div>
            <p className="h-eyebrow text-emerald-300">Check your inbox</p>
            <h1 className="h-display text-2xl text-cream-50 mt-1">Confirm your email</h1>
          </div>
          <p className="text-sm text-cream-100/80 leading-relaxed">
            We sent a confirmation link to <span className="text-cream-50 font-medium">{confirmedEmail}</span>.
            Click it and you&apos;ll come back here to finish setup.
          </p>
          <p className="text-xs text-cream-100/55">
            No email after a couple minutes? Check spam/Promotions, or{" "}
            <button
              type="button"
              onClick={() => setConfirmedEmail(null)}
              className="text-gold-400 underline"
            >
              try a different email
            </button>
            .
          </p>
          <Link href="/login" className="btn-secondary w-full">Already confirmed → Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
      <form onSubmit={submit} className="card p-7 w-full max-w-sm space-y-5">
        <div>
          <p className="h-eyebrow">Sign up</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Create your account</h1>
          <p className="text-xs text-cream-100/55 mt-1">Takes 30 seconds. You can name your crew when you start your first round.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Your name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cruz" required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required />
            <p className="text-[10px] text-cream-100/40 mt-1">Minimum 8 characters.</p>
          </div>
        </div>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>

        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-100/10" /></div>
          <div className="relative flex justify-center"><span className="px-2 text-xs uppercase tracking-wide text-cream-100/40 bg-brand-900">or</span></div>
        </div>
        <GoogleAuthButton next="/dashboard" />
        <p className="text-sm text-cream-100/60 text-center">
          Have an account? <Link href="/login" className="text-cream-50 underline">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
