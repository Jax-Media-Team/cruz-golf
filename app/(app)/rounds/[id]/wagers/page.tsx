import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { WagerAckClient } from "./wagers-client";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";

export default async function WagerAckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/wagers`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, status, courses(name), date, holes")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  const { data: games } = await sb
    .from("round_games")
    .select("id, game_type, name, stake_cents, allowance_pct, config")
    .eq("round_id", id)
    .order("name");

  const { data: invitees } = await sb
    .from("round_invitees")
    .select("profile_id, profiles(display_name)")
    .eq("round_id", id);

  const { data: acks } = await sb
    .from("round_wager_acks")
    .select("profile_id, acknowledged_at")
    .eq("round_id", id);

  const ackMap = new Map((acks ?? []).map((a: any) => [a.profile_id, a.acknowledged_at]));
  const peopleStatus = (invitees ?? []).map((i: any) => ({
    profile_id: i.profile_id,
    display_name: i.profiles?.display_name ?? "Player",
    acked: ackMap.has(i.profile_id)
  }));

  const myAck = ackMap.has(user.id);

  return (
    <div className="space-y-5 max-w-2xl">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={round.date}
        status={(round as any).status}
        page="Wagers"
      />
      <header>
        <p className="h-eyebrow">Confirm the wagers</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          {round.holes} holes · ${games?.reduce((s, g: any) => s + (g.stake_cents ?? 0), 0)
            ? "stakes posted"
            : "shake on it"}
        </h1>
      </header>

      <p className="text-sm text-cream-100/75">
        Tap to acknowledge the bets below. Your phone won&apos;t score until you do —
        keeps everyone honest if money&apos;s involved.
      </p>

      <WagerAckClient
        roundId={id}
        games={games ?? []}
        myAck={myAck}
        peopleStatus={peopleStatus}
      />
    </div>
  );
}
