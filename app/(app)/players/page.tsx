import { supabaseServer } from "@/lib/supabase/server";
import { PlayersClient } from "./players-client";

export default async function PlayersPage({
  searchParams
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  const groupId = groups?.[0]?.id;
  let q = sb
    .from("players")
    .select("id, display_name, email, phone, ghin_number, handicap_index, is_guest, profile_id, deleted_at")
    .eq("group_id", groupId ?? "")
    .order("display_name");
  if (!showArchived) q = q.is("deleted_at", null);
  const { data: players } = await q;
  return (
    <PlayersClient
      initialPlayers={players ?? []}
      groupId={groupId ?? null}
      currentUserId={user?.id ?? null}
      showArchived={showArchived}
    />
  );
}
