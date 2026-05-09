-- Owner-admin seed.
--
-- Patrick (the platform owner) needs the Admin nav to surface no matter
-- which auth provider / email he uses to sign in. Earlier we hand-promoted
-- one email; if he ever signs in with a different one (Google vs. password,
-- different alias), the flag is missing and Admin disappears.
--
-- This migration ships an idempotent SECURITY DEFINER function that grants
-- platform_admin to a hardcoded allowlist of owner emails. Safe to run on
-- every page load — ON CONFLICT makes it a cheap no-op when the grant
-- already exists, and emails not yet in auth.users are skipped silently.

create or replace function public.fn_seed_owner_admins()
returns void
language plpgsql
security definer
set search_path = public
as $SEED$
declare
  v_email text;
  v_id uuid;
  v_emails text[] := array[
    'pcruz@jaxmediateam.com'
  ];
begin
  foreach v_email in array v_emails loop
    select id into v_id from auth.users where lower(email) = lower(v_email);
    if v_id is null then continue; end if;
    -- Profile must exist or the FK explodes. Skip silently if onboarding
    -- hasn't finished for this user yet.
    if not exists (select 1 from public.profiles where id = v_id) then continue; end if;
    insert into public.platform_admins (profile_id, granted_by, notes)
    values (v_id, v_id, 'seeded by fn_seed_owner_admins')
    on conflict (profile_id) do nothing;
  end loop;
end;
$SEED$;

revoke all on function public.fn_seed_owner_admins() from public;
grant execute on function public.fn_seed_owner_admins() to authenticated;

-- Run once at migration time so the prod DB picks up the seed immediately.
select public.fn_seed_owner_admins();
