import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ScoreEntry } from "./score-entry";
import { RoundBreadcrumb } from "@/components/RoundBreadcrumb";

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
    .select("id, group_id, access_mode, status, date, courses(name)")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");

  // Finalized rounds reject score writes via RLS; surface that earlier
  // by routing the user back to the round page.
  if (round.status === "finalized") redirect(`/rounds/${id}`);

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

  // Wager handshake removed — no longer a gate to scoring.

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

  return (
    <div className="space-y-3">
      <RoundBreadcrumb
        roundId={id}
        courseName={(round as any).courses?.name ?? null}
        date={(round as any).date}
        status={round.status as any}
        page={`Score · ${(rp as any).players?.display_name ?? "Player"}`}
      />
      <ScoreEntry roundId={id} rp={rp as any} existing={existing ?? []} />
    </div>
  );
}
