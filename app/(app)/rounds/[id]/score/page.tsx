import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ScoreEntry } from "./score-entry";

export default async function ScoreEntryPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rp?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/rounds/${id}/score?rp=${sp.rp ?? ""}`);

  const { data: round } = await sb
    .from("rounds")
    .select("id, group_id, access_mode")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  // Commissioner override applies everywhere.
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

  // Wager handshake: if any game has stakes and this user hasn't acked, route them to wagers page.
  if (!isCommissioner) {
    const { count: stakedGames } = await sb
      .from("round_games")
      .select("id", { head: true, count: "exact" })
      .eq("round_id", id)
      .gt("stake_cents", 0);
    if ((stakedGames ?? 0) > 0) {
      const { data: ack } = await sb
        .from("round_wager_acks")
        .select("profile_id")
        .eq("round_id", id)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!ack) redirect(`/rounds/${id}/wagers`);
    }
  }

  const { data: rp } = await sb
    .from("round_players")
    .select("id, playing_handicap, players(display_name), course_tees(par, course_holes(hole_number, par, stroke_index))")
    .eq("id", sp.rp ?? "")
    .single();
  if (!rp) redirect(`/rounds/${id}`);

  const { data: existing } = await sb
    .from("scores")
    .select("hole_number, gross")
    .eq("round_player_id", sp.rp);

  return <ScoreEntry roundId={id} rp={rp as any} existing={existing ?? []} />;
}
