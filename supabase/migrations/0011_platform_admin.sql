-- Platform admin role + bootstrap.
--
-- Adds a platform-level admin role that's distinct from group-level
-- commissioner. Platform admins can see and manage every account, group,
-- round, and course in the system. Group commissioners only see their
-- own group.
--
-- Schema: a single `platform_admins` table keyed by profile_id. RLS only
-- allows existing platform admins to read/write. A SECURITY DEFINER helper
-- function fn_is_platform_admin() lets app code (and other RLS policies)
-- check the caller's status without juggling raw queries.
--
-- Bootstrap: fn_grant_platform_admin(email) accepts the very first grant
-- from any authenticated user when no admins exist. After that, only
-- existing admins can promote others.

create table if not exists public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  notes text
);

alter table public.platform_admins enable row level security;

drop policy if exists "platform_admins read" on public.platform_admins;
create policy "platform_admins read" on public.platform_admins for select
  using (
    exists (select 1 from public.platform_admins pa where pa.profile_id = auth.uid())
  );

drop policy if exists "platform_admins write" on public.platform_admins;
create policy "platform_admins write" on public.platform_admins for all
  using (
    exists (select 1 from public.platform_admins pa where pa.profile_id = auth.uid())
  )
  with check (
    exists (select 1 from public.platform_admins pa where pa.profile_id = auth.uid())
  );

-- Cheap, RLS-bypassing check used everywhere we need "is the caller admin?"
create or replace function public.fn_is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;

revoke all on function public.fn_is_platform_admin() from public;
grant execute on function public.fn_is_platform_admin() to authenticated;

-- Grant a user platform-admin status by email. The first grant works for
-- any authenticated caller when no admins exist (one-shot bootstrap).
-- After that, only existing platform admins can promote new ones.
create or replace function public.fn_grant_platform_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $GRANT$
declare
  v_target_id uuid;
  v_caller uuid := auth.uid();
  v_admin_count int;
begin
  select count(*) into v_admin_count from public.platform_admins;

  if v_admin_count > 0 then
    if v_caller is null
       or not exists (select 1 from public.platform_admins where profile_id = v_caller) then
      raise exception 'Only platform admins can grant new admins';
    end if;
  else
    if v_caller is null then
      raise exception 'Must be authenticated to bootstrap the first admin';
    end if;
  end if;

  -- Look up the target user by email in auth.users (SECURITY DEFINER
  -- gives us read access).
  select id into v_target_id
    from auth.users
   where lower(email) = lower(p_email);

  if v_target_id is null then
    raise exception 'No user with that email';
  end if;

  -- Make sure the profile row exists (it should, but defensive).
  if not exists (select 1 from public.profiles where id = v_target_id) then
    raise exception 'No profile for that user — finish onboarding first';
  end if;

  insert into public.platform_admins (profile_id, granted_by, notes)
  values (v_target_id, coalesce(v_caller, v_target_id), 'granted via fn_grant_platform_admin')
  on conflict (profile_id) do nothing;

  return 'ok';
end;
$GRANT$;

revoke all on function public.fn_grant_platform_admin(text) from public;
grant execute on function public.fn_grant_platform_admin(text) to authenticated;

-- Revoke a platform admin (only existing admins can do this; you can't
-- demote yourself if you'd be the last admin standing).
create or replace function public.fn_revoke_platform_admin(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $REVOKE$
declare
  v_caller uuid := auth.uid();
  v_admin_count int;
begin
  if v_caller is null
     or not exists (select 1 from public.platform_admins where profile_id = v_caller) then
    raise exception 'Only platform admins can revoke admins';
  end if;

  select count(*) into v_admin_count from public.platform_admins;
  if v_admin_count = 1 and exists (select 1 from public.platform_admins where profile_id = p_profile_id) then
    raise exception 'Cannot revoke the only remaining platform admin';
  end if;

  delete from public.platform_admins where profile_id = p_profile_id;
  return 'ok';
end;
$REVOKE$;

revoke all on function public.fn_revoke_platform_admin(uuid) from public;
grant execute on function public.fn_revoke_platform_admin(uuid) to authenticated;
