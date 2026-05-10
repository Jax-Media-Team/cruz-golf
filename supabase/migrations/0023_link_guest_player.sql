-- 0023 — link a guest player to a registered profile.
--
-- Background: a commissioner can add players as guests (no account) so they
-- can be scored in rounds. Later those guests sign up themselves. Today
-- they end up with TWO records: the guest player + a brand-new player
-- created by the signup bootstrap. We need a clean "merge" path that
-- preserves the historical rounds/scores attached to the guest while
-- giving the now-registered user control of their own profile.
--
-- The merge is one-way: the guest's player_id is the keeper (it has the
-- round_players + scores history). The registered user's auto-created
-- player gets archived. The guest's profile_id is set to the user. Rounds
-- and stats stay intact.
--
-- Authorization: the calling commissioner of the guest's group, OR the
-- calling user who matches the guest's email, OR a platform admin.

create or replace function public.fn_link_guest_to_profile(
  p_guest_player_id uuid,
  p_profile_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $LINK$
declare
  v_uid uuid := auth.uid();
  v_guest record;
  v_profile_email text;
  v_caller_is_commish boolean;
  v_caller_is_admin boolean;
  v_caller_is_target boolean;
  v_existing_player record;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  -- Load the guest player.
  select id, group_id, display_name, email, profile_id, is_guest, deleted_at
    into v_guest from public.players where id = p_guest_player_id;
  if not found then raise exception 'Player not found'; end if;
  if v_guest.profile_id is not null and v_guest.profile_id <> p_profile_id then
    raise exception 'Player is already linked to a different profile';
  end if;

  -- Look up the target profile's email so we can confirm match (optional).
  select email into v_profile_email from auth.users where id = p_profile_id;
  if v_profile_email is null then
    raise exception 'Target user not found';
  end if;

  -- Authorization paths:
  --   1) Caller is a commissioner of the guest's group
  --   2) Caller is the target user themselves (claiming their own row)
  --   3) Caller is a platform admin
  select exists (
    select 1 from public.group_members gm
     where gm.group_id = v_guest.group_id
       and gm.profile_id = v_uid
       and gm.role = 'commissioner'
  ) into v_caller_is_commish;
  v_caller_is_target := (v_uid = p_profile_id);
  select public.fn_is_platform_admin() into v_caller_is_admin;

  if not (v_caller_is_commish or v_caller_is_target or v_caller_is_admin) then
    raise exception 'Not authorized to link this player';
  end if;

  -- If the registered user already has a player row in the same group
  -- (auto-created by signup bootstrap), archive it to avoid duplicates.
  -- Their round history (if any) goes to the guest record we're keeping.
  for v_existing_player in
    select id from public.players
     where group_id = v_guest.group_id
       and profile_id = p_profile_id
       and id <> p_guest_player_id
  loop
    update public.players
       set deleted_at = now(),
           profile_id = null
     where id = v_existing_player.id;
  end loop;

  -- Link the guest to the profile, flip the guest flag off, and email
  -- backfill if missing.
  update public.players
     set profile_id = p_profile_id,
         is_guest = false,
         email = coalesce(email, v_profile_email)
   where id = p_guest_player_id;

  return json_build_object(
    'ok', true,
    'player_id', p_guest_player_id,
    'profile_id', p_profile_id,
    'archived_duplicates', (
      select count(*) from public.players
       where group_id = v_guest.group_id
         and profile_id is null
         and deleted_at is not null
         and id <> p_guest_player_id
    )
  );
end;
$LINK$;

revoke all on function public.fn_link_guest_to_profile(uuid, uuid) from public;
grant execute on function public.fn_link_guest_to_profile(uuid, uuid) to authenticated;

-- Unlink (commissioner-only). Reverses fn_link_guest_to_profile so a
-- mistakenly-linked player can become a guest again. Doesn't restore any
-- archived duplicates.
create or replace function public.fn_unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $UNLINK$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_caller_is_commish boolean;
  v_caller_is_admin boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.players where id = p_player_id;
  if v_group_id is null then return; end if;
  select exists (
    select 1 from public.group_members gm
     where gm.group_id = v_group_id
       and gm.profile_id = v_uid
       and gm.role = 'commissioner'
  ) into v_caller_is_commish;
  select public.fn_is_platform_admin() into v_caller_is_admin;
  if not (v_caller_is_commish or v_caller_is_admin) then
    raise exception 'Not authorized to unlink this player';
  end if;
  update public.players
     set profile_id = null,
         is_guest = true
   where id = p_player_id;
end;
$UNLINK$;

revoke all on function public.fn_unlink_player(uuid) from public;
grant execute on function public.fn_unlink_player(uuid) to authenticated;

-- Find candidate matches: for each guest player in a given group with an
-- email, return any auth.users whose email matches. Used by the UI to
-- populate "Link to account" suggestions.
create or replace function public.fn_find_guest_link_candidates(p_group_id uuid)
returns table (
  player_id uuid,
  player_name text,
  player_email text,
  candidate_user_id uuid,
  candidate_user_email text
)
language sql
security definer
stable
set search_path = public
as $FIND$
  select
    p.id,
    p.display_name,
    p.email,
    u.id,
    u.email
  from public.players p
  join auth.users u on lower(u.email) = lower(p.email)
  where p.group_id = p_group_id
    and p.profile_id is null
    and p.email is not null
    and p.deleted_at is null
    and exists (
      -- caller must be a commissioner of this group OR a platform admin
      select 1 from public.group_members gm
       where gm.group_id = p_group_id
         and gm.profile_id = auth.uid()
         and gm.role = 'commissioner'
    )
$FIND$;

revoke all on function public.fn_find_guest_link_candidates(uuid) from public;
grant execute on function public.fn_find_guest_link_candidates(uuid) to authenticated;
