import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { WagerAckClient } from "./wagers-client";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

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

  // Junk side-bet config — fetched here so the wagers card can surface
  // the full bet terms (categories + amount + escalation mode). Patrick
  // 2026-05-12 chaos-QA pass: "View wagers shows 6-6-6 but nothing
  // about the 2-down auto-press, the junk, etc."
  // Pre-0041 environments don't have these tables; defensive fetch.
  let junkConfig: any = null;
  try {
    const { data: cfgRow } = await sb
      .from("round_junk_config")
      .select(
        "active_categories, mode, flat_amount_cents, base_amount_cents, escalation_step_cents, escalation_scope, custom_categories"
      )
      .eq("round_id", id)
      .maybeSingle();
    const hasActiveCats =
      (Array.isArray((cfgRow as any)?.active_categories) &&
        ((cfgRow as any).active_categories as string[]).length > 0) ||
      (Array.isArray((cfgRow as any)?.custom_categories) &&
        ((cfgRow as any).custom_categories as any[]).length > 0);
    junkConfig = hasActiveCats ? cfgRow : null;
  } catch {
    /* junk tables missing — pre-0041 env */
  }

  // Round_players → for surfacing the team/partner composition on
  // 6-6-6 / Best Ball wagers. Without this the wagers card can't show
  // "Pat + Ben vs Mitch + Kyle" or the 6-6-6 rotation segments.
  let teamLineups: Array<{
    id: string;
    display_name: string;
    team_id: string | null;
  }> = [];
  try {
    const { data: rps } = await sb
      .from("round_players")
      .select("id, team_id, players(display_name)")
      .eq("round_id", id)
      .order("display_order");
    teamLineups = (rps ?? []).map((r: any) => ({
      id: r.id,
      display_name: r.players?.display_name ?? "Player",
      team_id: r.team_id ?? null
    }));
  } catch {
    /* fall back to no team display */
  }

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
        junkConfig={junkConfig}
        teamLineups={teamLineups}
      />
    </div>
  );
}
