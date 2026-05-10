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

  // Pull link candidates: guest players whose email matches a real auth.users
  // row. Defensive: the RPC lands in 0023; if it isn't applied yet, we skip
  // the suggestions silently so the page still renders.
  let linkCandidates: Array<{
    player_id: string;
    player_name: string;
    player_email: string;
    candidate_user_id: string;
    candidate_user_email: string;
  }> = [];
  if (groupId) {
    try {
      const { data, error } = await sb.rpc("fn_find_guest_link_candidates", {
        p_group_id: groupId
      });
      if (!error && Array.isArray(data)) {
        linkCandidates = data as any;
      }
    } catch {
      /* RPC missing — no suggestions */
    }
  }

  return (
    <PlayersClient
      initialPlayers={players ?? []}
      groupId={groupId ?? null}
      currentUserId={user?.id ?? null}
      showArchived={showArchived}
      linkCandidates={linkCandidates}
    />
  );
}
