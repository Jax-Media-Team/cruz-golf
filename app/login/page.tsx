"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BrandLockup } from "@/components/BrandLockup";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
      <form onSubmit={submit} className="card p-7 w-full max-w-sm space-y-4">
        <div>
          <p className="h-eyebrow">Sign in</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Welcome back.</h1>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoFocus />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-100/10" /></div>
          <div className="relative flex justify-center"><span className="px-2 text-xs uppercase tracking-wide text-cream-100/40 bg-brand-900">or</span></div>
        </div>
        <GoogleAuthButton next="/dashboard" />
        <p className="text-sm text-cream-100/60 text-center">
          New here? <Link href="/signup" className="text-cream-50 underline">Create a group</Link>
        </p>
      </form>
    </main>
  );
}
