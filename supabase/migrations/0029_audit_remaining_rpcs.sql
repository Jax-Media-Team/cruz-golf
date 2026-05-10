-- 0029 — close the audit-hook gap.
--
-- Migration 0027 wired audit hooks into the lifecycle RPCs (archive /
-- restore / verify / template_flag). This migration adds hooks to the
-- four remaining destructive RPCs:
--
--   - fn_delete_round           → 'round.delete'
--   - fn_dedupe_jgcc_in_group   → 'course.dedupe' (one row per archived dupe)
--   - fn_link_guest_to_profile  → 'player.link_guest'
--   - fn_unlink_player          → 'player.unlink'
--
-- All idempotent and safe to re-run.

-- fn_delete_round — full re-create with audit hook. Body matches 0021's
-- hardened version; only adds the audit-write at the very end.
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
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select group_id into v_group_id from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;

  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can delete this round';
  end if;

  begin
    delete from public.manual_entries
      where round_game_id in (select id from public.round_games where round_id = p_round_id);
    delete from public.settlements where round_id = p_round_id;
    delete from public.round_games where round_id = p_round_id;
    delete from public.scorecard_uploads where round_id = p_round_id;
    delete from public.round_wager_acks where round_id = p_round_id;
    delete from public.round_invitees where round_id = p_round_id;
    delete from public.round_invites where round_id = p_round_id;
    delete from public.scores
      where round_player_id in (select id from public.round_players where round_id = p_round_id);
    delete from public.round_players where round_id = p_round_id;
    delete from public.round_teams where round_id = p_round_id;
    update public.feedback set round_id = null where round_id = p_round_id;
    delete from public.rounds where id = p_round_id;
  exception
    when foreign_key_violation then
      raise exception 'Delete blocked by FK: %. Try archiving instead.', SQLERRM
        using errcode = 'FK_BLOCK';
    when others then
      raise exception 'Delete failed: % (code %). Try archiving instead.',
        SQLERRM, SQLSTATE
        using errcode = SQLSTATE;
  end;

  -- Audit AFTER successful delete. Note: target_id refers to a now-gone
  -- round; the audit row is the only remaining trace, which is the point.
  perform public.fn_log_destructive(
    'round.delete', p_round_id, 'rounds', v_group_id, '{}'::jsonb
  );
end;
$DELETE$;
revoke all on function public.fn_delete_round(uuid) from public;
grant execute on function public.fn_delete_round(uuid) to authenticated;

-- fn_dedupe_jgcc_in_group — full re-create with audit hook.
create or replace function public.fn_dedupe_jgcc_in_group(p_group_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $DEDUPE$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_commish boolean;
  v_canonical_id uuid;
  v_archived_count int := 0;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = p_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can dedupe courses';
  end if;

  -- Pick canonical: most holes, then oldest.
  select c.id into v_canonical_id
    from public.courses c
   where c.group_id = p_group_id
     and lower(c.name) like 'jacksonville golf%'
     and c.deleted_at is null
   order by (
     select count(*) from public.course_holes ch
       join public.course_tees ct on ct.id = ch.tee_id
      where ct.course_id = c.id
   ) desc, c.created_at asc
   limit 1;

  if v_canonical_id is null then
    return json_build_object('ok', true, 'canonical', null, 'archived', 0);
  end if;

  update public.courses
     set deleted_at = now()
   where group_id = p_group_id
     and lower(name) like 'jacksonville golf%'
     and id <> v_canonical_id
     and deleted_at is null;
  get diagnostics v_archived_count = row_count;

  perform public.fn_log_destructive(
    'course.dedupe', v_canonical_id, 'courses', p_group_id,
    jsonb_build_object('canonical', v_canonical_id, 'archived_count', v_archived_count)
  );

  return json_build_object(
    'ok', true,
    'canonical', v_canonical_id,
    'archived', v_archived_count
  );
end;
$DEDUPE$;
revoke all on function public.fn_dedupe_jgcc_in_group(uuid) from public;
grant execute on function public.fn_dedupe_jgcc_in_group(uuid) to authenticated;

-- fn_link_guest_to_profile — full re-create with audit hook.
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
  v_archived_count int := 0;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select id, group_id, display_name, email, profile_id, is_guest, deleted_at
    into v_guest from public.players where id = p_guest_player_id;
  if not found then raise exception 'Player not found'; end if;
  if v_guest.profile_id is not null and v_guest.profile_id <> p_profile_id then
    raise exception 'Player is already linked to a different profile';
  end if;

  select email into v_profile_email from auth.users where id = p_profile_id;
  if v_profile_email is null then
    raise exception 'Target user not found';
  end if;

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
    v_archived_count := v_archived_count + 1;
  end loop;

  update public.players
     set profile_id = p_profile_id,
         is_guest = false,
         email = coalesce(email, v_profile_email)
   where id = p_guest_player_id;

  perform public.fn_log_destructive(
    'player.link_guest', p_guest_player_id, 'players', v_guest.group_id,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'archived_duplicates', v_archived_count
    )
  );

  return json_build_object(
    'ok', true,
    'player_id', p_guest_player_id,
    'profile_id', p_profile_id,
    'archived_duplicates', v_archived_count
  );
end;
$LINK$;
revoke all on function public.fn_link_guest_to_profile(uuid, uuid) from public;
grant execute on function public.fn_link_guest_to_profile(uuid, uuid) to authenticated;

-- fn_unlink_player — full re-create with audit hook.
create or replace function public.fn_unlink_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $UNLINK$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_profile_before uuid;
  v_caller_is_commish boolean;
  v_caller_is_admin boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id, profile_id into v_group_id, v_profile_before
    from public.players where id = p_player_id;
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

  perform public.fn_log_destructive(
    'player.unlink', p_player_id, 'players', v_group_id,
    jsonb_build_object('previous_profile_id', v_profile_before)
  );
end;
$UNLINK$;
revoke all on function public.fn_unlink_player(uuid) from public;
grant execute on function public.fn_unlink_player(uuid) to authenticated;
