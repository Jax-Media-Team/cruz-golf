import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { FinalizeView } from "./finalize-view";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";

export default async function FinalizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: round } = await sb
    .from("rounds")
    .select("id, status, holes, starting_hole, date, courses(name)")
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

  // Manual presses (accepted only) — settled alongside the auto-press
  // chains. Defensive against the table not existing pre-0035.
  let manualPresses: any[] = [];
  try {
    const { data: presses, error } = await sb
      .from("round_presses")
      .select(
        "id, game_id, segment_label, start_hole, end_hole, stake_cents, side_a_rp_ids, side_b_rp_ids, status"
      )
      .eq("round_id", id)
      .eq("status", "accepted");
    if (!error && presses) manualPresses = presses;
  } catch {
    /* table missing — pre-0035 env */
  }

  return (
    <div className="space-y-3">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={round.date}
        status={round.status as any}
        page="Settle up"
      />
      <FinalizeView
        roundId={id}
        rps={rps ?? []}
        scores={scores ?? []}
        games={games ?? []}
        manualPresses={manualPresses}
        totalHoles={(round.holes as 9 | 18) ?? 18}
        startingHole={round.starting_hole ?? 1}
      />
    </div>
  );
}
