import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Diagnostic endpoint: tells the signed-in user exactly why scores might be
 * failing for a given round. Returns a structured report with each RLS
 * pre-condition the saver write must pass.
 *
 * Used by the SaveStatusBanner when an RLS-denied error is detected, so
 * we can surface a one-click "tell me what's broken" path without forcing
 * the user to inspect their Supabase tables manually.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const roundId = url.searchParams.get("round_id");
  if (!roundId) return NextResponse.json({ error: "round_id required" }, { status: 400 });

  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: round, error: rerr } = await sb
    .from("rounds")
    .select("id, group_id, access_mode, status")
    .eq("id", roundId)
    .maybeSingle();
  if (rerr || !round) {
    return NextResponse.json(
      {
        ok: false,
        reason: "round_not_visible",
        explain:
          "The round either doesn't exist or your account isn't a member of its group. The round table's RLS hides rounds from non-members.",
        signed_in_as: user.id
      },
      { status: 200 }
    );
  }

  const [{ data: gm }, { data: invite }, { data: stakedGames }, { data: ack }] = await Promise.all([
    sb
      .from("group_members")
      .select("role")
      .eq("group_id", round.group_id)
      .eq("profile_id", user.id)
      .maybeSingle(),
    sb
      .from("round_invitees")
      .select("profile_id")
      .eq("round_id", round.id)
      .eq("profile_id", user.id)
      .maybeSingle(),
    sb
      .from("round_games")
      .select("id")
      .eq("round_id", round.id)
      .gt("stake_cents", 0),
    sb
      .from("round_wager_acks")
      .select("acknowledged_at")
      .eq("round_id", round.id)
      .eq("profile_id", user.id)
      .maybeSingle()
  ]);

  const hasStakes = (stakedGames?.length ?? 0) > 0;
  const isCommissioner = gm?.role === "commissioner";
  const isInvitee = !!invite || round.access_mode === "open_to_group";
  const hasAck = !!ack;

  const canWriteScores =
    isCommissioner || (isInvitee && (!hasStakes || hasAck));

  // Build a human-readable reason if the user can't write.
  let reason = "ok";
  let explain = "Everything checks out — score writes should succeed.";
  if (!canWriteScores) {
    if (!gm) {
      reason = "not_in_group";
      explain =
        "You're not a member of this round's group. Either you weren't invited, or your account onboarding never finished. Try signing out and signing back in.";
    } else if (!isCommissioner && !isInvitee) {
      reason = "not_invitee";
      explain =
        "You're a member of the group but haven't been added to this specific round. Open the round and join via PIN, or ask the round owner to invite you.";
    } else if (!isCommissioner && hasStakes && !hasAck) {
      reason = "wagers_unacked";
      explain =
        "This round has wagers and you haven't confirmed them yet. Open /rounds/[id]/wagers and tap Confirm.";
    } else {
      reason = "unknown";
      explain =
        "Pre-conditions look fine but something else denied the write. Check DevTools console for the underlying Postgres error.";
    }
  }

  return NextResponse.json({
    ok: canWriteScores,
    reason,
    explain,
    facts: {
      signed_in_as: user.id,
      round_id: round.id,
      round_group_id: round.group_id,
      round_status: round.status,
      round_access_mode: round.access_mode,
      group_member_role: gm?.role ?? null,
      is_commissioner: isCommissioner,
      is_invitee: isInvitee,
      has_staked_games: hasStakes,
      has_wager_ack: hasAck
    }
  });
}
