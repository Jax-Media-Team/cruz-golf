import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { InvitesClient } from "./invites-client";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

export default async function InvitesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/invites`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, pin, status, date, courses(name)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", round.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (gm?.role !== "commissioner") redirect(`/rounds/${id}`);

  const { data: invites } = await sb
    .from("round_invites")
    .select("id, intended_for_name, intended_email, token, redeemed_at, expires_at, created_at")
    .eq("round_id", id)
    .order("created_at", { ascending: false });

  // Pre-load round players to suggest invitees.
  const { data: rps } = await sb
    .from("round_players")
    .select("players(display_name, email)")
    .eq("round_id", id);

  return (
    <div className="space-y-5 max-w-2xl">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={(round as any).date}
        status={(round as any).status}
        page="Invites"
      />
      <header>
        <p className="h-eyebrow">Round invites</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Invite your crew</h1>
      </header>
      <p className="text-sm text-cream-100/70">
        Each invite is a one-time link tied to the person you name. Once they
        tap it and sign in, the link is dead — they can&apos;t forward it. Bind
        it to their email for the strictest gate.
      </p>
      <InvitesClient
        roundId={id}
        initialInvites={invites ?? []}
        suggestedNames={(rps ?? []).map((r: any) => r.players?.display_name).filter(Boolean) as string[]}
      />
    </div>
  );
}
