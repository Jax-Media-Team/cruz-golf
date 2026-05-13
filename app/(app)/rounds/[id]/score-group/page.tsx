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
    .select("id, player_id, team_id, playing_handicap, display_order, players(display_name, profile_id), course_tees(par, course_holes(hole_number, par, stroke_index))")
    .eq("round_id", id)
    .order("display_order");

  const rpIds = (rps ?? []).map((r: any) => r.id);
  const { data: existing } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", rpIds.length > 0 ? rpIds : ["00000000-0000-0000-0000-000000000000"]);

  // Round games + manual presses — needed for inline PressControls.
  // Patrick 2026-05-13: "Junk and Open Press should be available
  // directly from the Enter Scores screen."
  const { data: games } = await sb
    .from("round_games")
    .select("id, game_type, name, stake_cents, allowance_pct, config")
    .eq("round_id", id);

  let presses: any[] = [];
  try {
    const { data: pressRows } = await sb
      .from("round_presses")
      .select(
        "id, game_id, segment_label, start_hole, end_hole, stake_cents, side_a_rp_ids, side_b_rp_ids, opened_by_rp_id, opened_at, accepted_at, declined_at, withdrawn_at, status"
      )
      .eq("round_id", id)
      .in("status", ["pending", "accepted"])
      .order("opened_at", { ascending: false });
    presses = pressRows ?? [];
  } catch {
    /* pre-0035 env — press table missing */
  }

  // "My rp" — needed for PressControls so it knows which side is "me".
  const myRpId =
    (rps ?? []).find((r: any) => r.players?.profile_id === user.id)?.id ?? null;

  // Junk side-bet config + items — fetched here so the score-group
  // page can render `<JunkControls>` inline. Patrick 2026-05-12:
  // "How do I keep track of junk during the scorekeeping? I did not
  // see any options to add junk. Should be simple."
  // The round detail page used to be the only surface for junk entry,
  // but that meant golfers had to leave the scoring screen and walk
  // back. Now the entry UI sits right under the scorecard.
  // Defensive against pre-0041 environments (junk tables don't exist).
  let junkConfig: any = null;
  let junkItems: any[] = [];
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
    if (cfgRow) {
      const { data: jItems } = await sb
        .from("round_junk_items")
        .select(
          "id, round_player_id, hole_number, category, custom_label, amount_cents, created_at, created_by, note"
        )
        .eq("round_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      junkItems = jItems ?? [];
    }
  } catch {
    /* tables missing — pre-0041 env, page renders without junk panel */
  }

  // (Reuses the `isCommissioner` declared above for the access-mode
  // check — JunkControls surfaces edit/delete affordances only for
  // the commissioner; other players see a read-only chip list.)

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
        totalHoles={18}
        junkConfig={junkConfig}
        junkItems={junkItems}
        isCommissioner={isCommissioner}
        games={games ?? []}
        presses={presses ?? []}
        myRpId={myRpId}
      />
    </div>
  );
}
