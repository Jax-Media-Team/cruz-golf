import { supabaseServer } from "@/lib/supabase/server";
import { PlayersClient } from "./players-client";

export default async function PlayersPage() {
  const sb = await supabaseServer();
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  const groupId = groups?.[0]?.id;
  const { data: players } = await sb
    .from("players")
    .select("id, display_name, email, phone, ghin_number, handicap_index, is_guest")
    .eq("group_id", groupId ?? "")
    .is("deleted_at", null)
    .order("display_name");
  return <PlayersClient initialPlayers={players ?? []} groupId={groupId ?? null} />;
}
