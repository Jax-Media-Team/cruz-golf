import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { FinalizeView } from "./finalize-view";

export default async function FinalizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: round } = await sb
    .from("rounds")
    .select("id, status, holes, starting_hole")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  const { data: rps } = await sb
    .from("round_players")
    .select("id, player_id, tee_id, course_handicap, playing_handicap, team_id, display_order, players(display_name), course_tees(id, name, rating, slope, par, course_holes(hole_number, par, stroke_index))")
    .eq("round_id", id)
    .order("display_order");

  const { data: scores } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", (rps ?? []).map((r: any) => r.id));

  const { data: games } = await sb
    .from("round_games")
    .select("id, game_type, name, stake_cents, allowance_pct, config")
    .eq("round_id", id);

  return (
    <FinalizeView
      roundId={id}
      rps={rps ?? []}
      scores={scores ?? []}
      games={games ?? []}
      totalHoles={(round.holes as 9 | 18) ?? 18}
      startingHole={round.starting_hole ?? 1}
    />
  );
}
