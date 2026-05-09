-- Self-promote-to-commissioner function.
--
-- Recovery path for accounts that ended up with role='player' on a group
-- they actually OWN. fn_bootstrap_account always sets 'commissioner' on
-- new accounts, but legacy or partial sign-ups may have left a user
-- mis-roled. Lets the group owner fix their own membership without an
-- admin SQL session.
--
-- Safe because we re-check that the caller is the group's owner_id —
-- non-owners cannot use this to escalate.

create or replace function public.fn_promote_self_in_owned_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $PROMO$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id into v_owner from public.groups where id = p_group_id;
  if v_owner is null then
    raise exception 'Group not found';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the group owner can self-promote in this group';
  end if;

  -- Insert a membership row if missing, otherwise update role.
  insert into public.group_members (group_id, profile_id, player_id, role)
  values (p_group_id, v_uid, gen_random_uuid(), 'commissioner')
  on conflict (group_id, player_id) do nothing;

  update public.group_members
     set role = 'commissioner'
   where group_id = p_group_id
     and profile_id = v_uid;

  return 'ok';
end;
$PROMO$;

revoke all on function public.fn_promote_self_in_owned_group(uuid) from public;
grant execute on function public.fn_promote_self_in_owned_group(uuid) to authenticated;
