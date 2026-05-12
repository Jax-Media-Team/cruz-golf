import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { GroupScoreEntry } from "./group-score-entry";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";
// Force dynamic rendering. Without this, Next.js 15 can statically
// prerender this server component at build time with no auth cookie
// — every Supabase fetch returns empty under RLS, the page renders
// empty, and the user sees a stale or blank surface. Critical fix
// (Patrick 2026-05-12: 'All my past rounds are empty').
export const dynamic = "force-dynamic";

export default async function GroupScorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/score-group`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, access_mode, status, date, courses(name)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  // Finalized rounds shouldn't accept new scores. Bounce the user back to
  // the round page where the commissioner sees the "Unlock to edit"
  // option. Without this, players landed on a working-looking form whose
  // saves silently failed RLS.
  if (round.status === "finalized") redirect(`/rounds/${id}`);

  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", round.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const isCommissioner = gm?.role === "commissioner";

  if (!isCommissioner && round.access_mode !== "open_to_group") {
    const { data: invite } = await sb
      .from("round_invitees")
      .select("profile_id")
      .eq("round_id", id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!invite) redirect(`/rounds/${id}/join`);
  }

  // Wager handshake (group scorer must have ack'd if any stakes).
  if (!isCommissioner) {
    // Wager handshake removed per product decision — was friction more than
    // value. The /wagers page still exists for groups that explicitly want
    // it, but it's no longer a gate to scoring.
  }

  const { data: rps } = await sb
    .from("round_players")
    .select("id, playing_handicap, display_order, players(display_name), course_tees(par, course_holes(hole_number, par, stroke_index))")
    .eq("round_id", id)
    .order("display_order");

  const rpIds = (rps ?? []).map((r: any) => r.id);
  const { data: existing } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"]);

  const courseName = (round as any).courses?.name ?? "Round";

  return (
    <div className="space-y-3">
      <RoundBreadcrumb
        roundId={id}
        courseName={courseName}
        date={(round as any).date}
        status={round.status as any}
        page="Group scoresheet"
      />
      <GroupScoreEntry
        roundId={id}
        courseName={courseName}
        rps={(rps as any) ?? []}
        existing={existing ?? []}
        roundStatus={round.status as any}
      />
    </div>
  );
}
