"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BrandLockup } from "@/components/BrandLockup";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { FacebookAuthButton } from "@/components/FacebookAuthButton";
import { friendlyAuthError } from "@/lib/auth-errors";

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

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
        data: { full_name: fullName, first_name: firstName.trim(), last_name: lastName.trim() }
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
      p_display_name: fullName,
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
        <div className="card p-7 w-full max-w-md space-y-4">
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/40 flex items-center justify-center text-emerald-300 text-2xl">
              ✉️
            </div>
            <p className="h-eyebrow text-emerald-300 mt-3">Check your inbox</p>
            <h1 className="h-display text-2xl text-cream-50 mt-1">Confirm your email</h1>
          </div>
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3 text-sm space-y-2">
            <p className="text-cream-50">
              Confirmation link sent to{" "}
              <span className="font-medium">{confirmedEmail}</span>.
            </p>
            <ol className="text-cream-100/85 space-y-1 list-decimal list-inside text-[13px]">
              <li>Open the email from <span className="text-cream-50">Cruz Golf</span> (sender may show as <code className="text-cream-100/70 text-[11px]">noreply@…supabase.io</code>).</li>
              <li>Click <span className="text-cream-50 font-medium">Confirm your mail</span>.</li>
              <li>You&apos;ll be returned here to finish setup.</li>
            </ol>
          </div>
          <div className="rounded-lg bg-amber-500/8 border border-amber-400/25 p-3 text-[12px] text-amber-100/85 leading-snug">
            <p className="font-medium text-amber-100">Not seeing the email?</p>
            <ul className="mt-1 space-y-0.5">
              <li>• Check spam / Promotions / Updates folders</li>
              <li>• Wait up to 2 minutes (built-in mail delivery is rate-limited)</li>
              <li>• Make sure {confirmedEmail.split("@")[1]} isn&apos;t blocking automated mail</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/login" className="btn-secondary w-full text-center">
              Already confirmed → Sign in
            </Link>
            <button
              type="button"
              onClick={() => setConfirmedEmail(null)}
              className="text-xs text-cream-100/55 hover:text-cream-100 text-center"
            >
              Try a different email address
            </button>
          </div>
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

        {/* OAuth above email/password — one tap for users who already
            have Google or Facebook. Audit P1 #10. */}
        <GoogleAuthButton next="/dashboard" />
        <FacebookAuthButton next="/dashboard" />
        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-100/10" /></div>
          <div className="relative flex justify-center"><span className="px-2 text-xs uppercase tracking-wide text-cream-100/40 bg-brand-900">or sign up with email</span></div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">First name</label>
              <input
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Patrick"
                required
                autoComplete="given-name"
              />
            </div>
            <div>
              <label className="label">Last name</label>
              <input
                className="input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Cruz"
                required
                autoComplete="family-name"
              />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required autoComplete="new-password" />
            {/* Bumped from 10px to 12px + live green-check at 8 chars.
                Audit P1 #15 — golfers were typing "golf123" and getting
                an opaque server error. */}
            <p className={`text-xs mt-1 ${password.length >= 8 ? "text-emerald-300" : "text-cream-100/55"}`}>
              {password.length >= 8 ? "✓ " : ""}Minimum 8 characters{password.length > 0 && password.length < 8 ? ` (${8 - password.length} to go)` : ""}.
            </p>
          </div>
        </div>

        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>

        <p className="text-sm text-cream-100/60 text-center">
          Have an account? <Link href="/login" className="text-cream-50 underline">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
