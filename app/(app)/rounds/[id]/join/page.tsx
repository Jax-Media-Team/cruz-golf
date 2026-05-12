import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { JoinForm } from "./join-form";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

export default async function JoinRoundPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    const next = encodeURIComponent(`/rounds/${id}/join${sp.invite ? `?invite=${sp.invite}` : ""}`);
    redirect(`/login?next=${next}`);
  }

  const { data: round } = await sb
    .from("rounds")
    .select("id, date, status, access_mode, courses(name)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  const { data: existing } = await sb
    .from("round_invitees")
    .select("profile_id")
    .eq("round_id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (existing) redirect(`/rounds/${id}`);

  // Look up an unused invite if a token was passed.
  let invitePreview: { name: string; email: string | null } | null = null;
  let inviteError: string | null = null;
  if (sp.invite) {
    const { data: inv } = await sb
      .from("round_invites")
      .select("intended_for_name, intended_email, redeemed_at, expires_at")
      .eq("round_id", id)
      .eq("token", sp.invite)
      .maybeSingle();
    if (!inv) inviteError = "That invite link isn't valid for this round.";
    else if (inv.redeemed_at) inviteError = "That invite has already been used.";
    else if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) inviteError = "That invite has expired.";
    else invitePreview = { name: inv.intended_for_name, email: inv.intended_email };
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card p-7 space-y-4">
        <div>
          <p className="h-eyebrow">Join round</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{(round as any).courses?.name}</h1>
          <p className="text-sm text-cream-100/60 mt-1">{round.date}</p>
        </div>
        {invitePreview ? (
          <p className="text-sm text-cream-100/85">
            You&apos;ve got an invite for <span className="text-cream-50 font-medium">{invitePreview.name}</span>
            {invitePreview.email && <> (locked to <span className="text-cream-50">{invitePreview.email}</span>)</>}.
          </p>
        ) : (
          <p className="text-sm text-cream-100/70">
            Enter the round PIN Cruz shared with you. Once you join, your phone is
            authorized to score for the rest of the round.
          </p>
        )}
        {inviteError && <p className="text-sm text-red-300">{inviteError}</p>}
        <JoinForm roundId={id} inviteToken={sp.invite ?? null} hasValidInvite={!!invitePreview} />
        <Link href="/dashboard" className="btn-ghost text-sm w-full">Back to dashboard</Link>
      </div>
    </div>
  );
}
