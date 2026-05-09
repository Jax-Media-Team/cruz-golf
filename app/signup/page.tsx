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
  const [groupName, setGroupName] = useState("");
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
    const { data: signup, error } = await sb.auth.signUp({ email, password });
    if (error || !signup.user) {
      setBusy(false);
      setErr(friendlyAuthError(error ?? "Sign-up failed"));
      return;
    }
    const profile = await sb.from("profiles").upsert({ id: signup.user.id, display_name: name });
    if (profile.error) {
      setBusy(false);
      setErr(friendlyAuthError(profile.error));
      return;
    }
    const finalGroupName = groupName.trim() || `${name.split(" ")[0] || "My"}'s Group`;
    const { data: g, error: ge } = await sb
      .from("groups")
      .insert({ name: finalGroupName, owner_id: signup.user.id })
      .select("id")
      .single();
    if (ge || !g) {
      setBusy(false);
      setErr(friendlyAuthError(ge ?? "Could not create group"));
      return;
    }
    await sb
      .from("group_members")
      .insert({ group_id: g.id, profile_id: signup.user.id, player_id: signup.user.id, role: "commissioner" });
    setBusy(false);
    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <Link href="/" className="mb-8"><BrandLockup iconHeight={120} /></Link>
      <form onSubmit={submit} className="card p-7 w-full max-w-sm space-y-5">
        <div>
          <p className="h-eyebrow">Step 1 of 2</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Create your account</h1>
          <p className="text-xs text-cream-100/55 mt-1">Takes 30 seconds. We&apos;ll set up your first group on the next breath.</p>
        </div>

        {/* Account fields */}
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

        {/* Group section — same form, secondary framing */}
        <div className="border-t border-cream-100/10 pt-4 space-y-3">
          <div>
            <p className="h-eyebrow">Step 2 of 2</p>
            <h2 className="font-serif text-xl text-cream-50 mt-1">Name your first group</h2>
            <p className="text-xs text-cream-100/55 mt-0.5">
              The recurring set of golfers you play with. You can rename it later or add more.
            </p>
          </div>
          <div>
            <label className="label">Group name</label>
            <input
              className="input"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Saturday Crew · Members' Day · Wednesday Skins"
            />
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
