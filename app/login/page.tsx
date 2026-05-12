"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BrandLockup } from "@/components/BrandLockup";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";
import { FacebookAuthButton } from "@/components/FacebookAuthButton";
import { friendlyAuthError } from "@/lib/auth-errors";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginShell() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
    </main>
  );
}

function LoginInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const justSignedOut = searchParams?.get("signedOut") === "1";
  const justConfirmed = searchParams?.get("confirmed") === "1";

  // Belt-and-suspenders: when arriving with ?signedOut=1, also clear any
  // lingering client-side session in case the SSR cookie clear missed.
  useEffect(() => {
    if (justSignedOut) {
      const sb = supabaseBrowser();
      sb.auth.signOut().catch(() => {});
    }
  }, [justSignedOut]);

  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentTo, setResentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNeedsConfirm(false);
    setResentTo(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("not confirmed") || msg.includes("not verified")) {
        setNeedsConfirm(true);
        setErr("Email not confirmed yet — check your inbox.");
      } else {
        setErr(friendlyAuthError(error));
      }
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function resendConfirm() {
    if (!email.trim() || resending) return;
    setResending(true);
    setErr(null);
    const sb = supabaseBrowser();
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=/onboarding`
        : undefined;
    const { error } = await sb.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectTo }
    });
    setResending(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    setResentTo(email);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
      {justSignedOut && (
        <div className="mb-4 w-full max-w-sm rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
          Signed out. See you next round.
        </div>
      )}
      {justConfirmed && (
        <div className="mb-4 w-full max-w-sm rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5 text-sm text-gold-200">
          Email confirmed. Sign in to finish setup.
        </div>
      )}
      <form onSubmit={submit} className="card p-7 w-full max-w-sm space-y-4">
        <div>
          <p className="h-eyebrow">Sign in</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Welcome back.</h1>
        </div>
        {/* OAuth above email/password — returning users who signed up
            with Google or Facebook hit one tap. Audit P1 #10. */}
        <GoogleAuthButton next="/dashboard" />
        <FacebookAuthButton next="/dashboard" />
        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-100/10" /></div>
          <div className="relative flex justify-center"><span className="px-2 text-xs uppercase tracking-wide text-cream-100/40 bg-brand-900">or sign in with email</span></div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        {needsConfirm && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs space-y-2">
            <p className="text-amber-100/90">
              Your email address hasn&apos;t been confirmed yet. Look for an
              email from <span className="font-medium">Cruz Golf</span>{" "}
              (the sender may show as a noreply@ address) and click the
              confirmation link. Check your spam / Promotions folder if
              you don&apos;t see it within a minute or two.
            </p>
            <button
              type="button"
              onClick={resendConfirm}
              disabled={resending || !email.trim()}
              className="pill bg-amber-200 text-amber-900 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
            >
              {resending ? "Sending…" : "Resend confirmation email"}
            </button>
            {resentTo && (
              <p className="text-emerald-300 text-[11px]">
                ✓ Sent another confirmation to {resentTo}.
              </p>
            )}
          </div>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-sm text-cream-100/60 text-center">
          New here? <Link href="/signup" className="text-cream-50 underline">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
