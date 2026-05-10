-- Atomic round deletion.
--
-- The "Linked record is missing" error users sometimes hit when deleting a
-- round is the symptom of cascade DELETE ordering, RLS-on-cascade quirks,
-- or stale cached rows the client thinks exist. A SECURITY DEFINER RPC
-- gives us deterministic teardown order and a clean permission check —
-- the caller must be a commissioner of the round's group, OR a platform
-- admin.

create or replace function public.fn_delete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $DELETE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then
    raise exception 'Must be authenticated';
  end if;

  -- Locate round (idempotent: if already gone, succeed silently).
  select group_id into v_group_id from public.rounds where id = p_round_id;
  if v_group_id is null then
    return;
  end if;

  -- Permission check: platform admin or group commissioner.
  select exists (select 1 from public.platform_admins where profile_id = v_uid)
    into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id
       and profile_id = v_uid
       and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can delete this round';
  end if;

  -- Tear down children in dependency order, then the round itself. Ordering
  -- is deterministic and RLS-bypassing thanks to SECURITY DEFINER.
  delete from public.settlements where round_id = p_round_id;
  delete from public.manual_entries
    where round_game_id in (select id from public.round_games where round_id = p_round_id);
  delete from public.round_games where round_id = p_round_id;
  delete from public.scorecard_uploads where round_id = p_round_id;
  delete from public.round_wager_acks where round_id = p_round_id;
  delete from public.round_invitees where round_id = p_round_id;
  delete from public.round_invites where round_id = p_round_id;
  delete from public.scores
    where round_player_id in (select id from public.round_players where round_id = p_round_id);
  delete from public.round_players where round_id = p_round_id;
  delete from public.round_teams where round_id = p_round_id;
  delete from public.rounds where id = p_round_id;
end;
$DELETE$;

revoke all on function public.fn_delete_round(uuid) from public;
grant execute on function public.fn_delete_round(uuid) to authenticated;
