import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { InvitesClient } from "./invites-client";

export default async function InvitesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/invites`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, pin, courses(name)")
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
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="h-eyebrow">Round invites</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{(round as any).courses?.name}</h1>
        </div>
        <Link href={`/rounds/${id}`} className="btn-ghost text-sm">← Round</Link>
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
