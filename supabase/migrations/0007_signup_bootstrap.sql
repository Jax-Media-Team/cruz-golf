-- Atomic signup bootstrap.
--
-- Original signup did 4 separate client-side inserts (profile, group,
-- group_members) and broke when:
--   (a) email confirmation was on -> no session -> auth.uid() = null ->
--       profiles RLS denied silently -> groups insert failed with FK on
--       owner_id ("Linked record is missing").
--   (b) group_members had no INSERT policy at all (only SELECT).
--
-- Fix: a SECURITY DEFINER function that creates profile + group + commissioner
-- membership in one transaction, plus the missing group_members policies for
-- direct use elsewhere.

-- Missing RLS for group_members.
drop policy if exists "group_members write" on public.group_members;
create policy "group_members write" on public.group_members for insert
  with check (
    -- Either the row is yours, or you're an existing commissioner of the group.
    profile_id = auth.uid()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.profile_id = auth.uid()
        and gm.role = 'commissioner'
    )
  );

drop policy if exists "group_members update" on public.group_members;
create policy "group_members update" on public.group_members for update
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.profile_id = auth.uid()
        and gm.role = 'commissioner'
    )
  );

drop policy if exists "group_members delete" on public.group_members;
create policy "group_members delete" on public.group_members for delete
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.profile_id = auth.uid()
        and gm.role = 'commissioner'
    )
  );

-- Bootstrap: create profile + group + commissioner membership for the caller.
-- Idempotent on the profile (upsert), but only creates one new group per call.
create or replace function public.fn_bootstrap_account(
  p_display_name text,
  p_group_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $BS$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_player_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Profile (idempotent on display name; upsert covers re-runs).
  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(nullif(trim(p_display_name), ''), 'Player'))
  on conflict (id) do update set display_name = excluded.display_name;

  -- Group.
  insert into public.groups (name, owner_id)
  values (
    coalesce(nullif(trim(p_group_name), ''), split_part(p_display_name, ' ', 1) || '''s Group'),
    v_uid
  )
  returning id into v_group_id;

  -- Commissioner membership. player_id is a uuid we mint so the caller can
  -- later be promoted to a real "player" row tied to their profile.
  insert into public.group_members (group_id, profile_id, player_id, role)
  values (v_group_id, v_uid, v_player_id, 'commissioner');

  -- Also create a corresponding players row tied to this profile so the
  -- commissioner shows up in the group roster.
  insert into public.players (id, group_id, profile_id, display_name)
  values (v_player_id, v_group_id, v_uid, coalesce(nullif(trim(p_display_name), ''), 'Player'));

  return v_group_id;
end;
$BS$;

revoke all on function public.fn_bootstrap_account(text, text) from public;
grant execute on function public.fn_bootstrap_account(text, text) to authenticated;
