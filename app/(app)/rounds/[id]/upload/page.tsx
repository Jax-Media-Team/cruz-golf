import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { UploadView } from "./upload-view";

export default async function UploadCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: round } = await sb
    .from("rounds")
    .select("id, holes, round_players(id, players(display_name)), course_id")
    .eq("id", id)
    .single();
  if (!round) redirect("/dashboard");
  const players = (round.round_players ?? []).map((rp: any) => ({
    round_player_id: rp.id,
    name: rp.players?.display_name ?? "Player"
  }));
  return <UploadView roundId={id} holes={round.holes as 9 | 18} players={players} />;
}
