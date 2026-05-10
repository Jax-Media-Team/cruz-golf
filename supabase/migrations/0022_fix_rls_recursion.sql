-- 0022 — fix RLS recursion on platform_admins.
--
-- INCIDENT 2026-05-10: "infinite recursion detected in policy for relation
-- 'platform_admins'" thrown when adding courses (and also feedback, JGCC
-- quick-add, etc.). Root cause: every direct
--
--    EXISTS (SELECT 1 FROM public.platform_admins ...)
--
-- inside an RLS policy triggers RLS evaluation on platform_admins, which
-- itself queries platform_admins inside its own policy, recursing.
--
-- Fix: every direct platform_admins SELECT in any policy is replaced with
-- a call to public.fn_is_platform_admin() — a SECURITY DEFINER function
-- whose body bypasses RLS because it runs as the owner (postgres). The
-- platform_admins SELECT policy itself is rewritten to be non-recursive
-- ("you can see your own row"); admin listing in the app uses the
-- service-role client which bypasses RLS entirely.

-- ---- platform_admins: non-recursive policies ----
drop policy if exists "platform_admins read" on public.platform_admins;
create policy "platform_admins read" on public.platform_admins for select
  using (profile_id = auth.uid());

drop policy if exists "platform_admins write" on public.platform_admins;
create policy "platform_admins write" on public.platform_admins for all
  using ( public.fn_is_platform_admin() )
  with check ( public.fn_is_platform_admin() );

-- ---- feedback (0014): replace direct platform_admins SELECTs ----
drop policy if exists "feedback read self or admin" on public.feedback;
create policy "feedback read self or admin" on public.feedback for select
  using (
    profile_id = auth.uid()
    or public.fn_is_platform_admin()
  );

drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback admin update" on public.feedback for update
  using ( public.fn_is_platform_admin() )
  with check ( public.fn_is_platform_admin() );

drop policy if exists "feedback admin delete" on public.feedback;
create policy "feedback admin delete" on public.feedback for delete
  using ( public.fn_is_platform_admin() );

-- ---- courses templates (0020): replace direct platform_admins SELECT ----
drop policy if exists "courses templates admin write" on public.courses;
create policy "courses templates admin write" on public.courses for all
  using ( is_template = true and public.fn_is_platform_admin() )
  with check ( is_template = true and public.fn_is_platform_admin() );

-- Sanity: ensure fn_is_platform_admin is still SECURITY DEFINER + STABLE +
-- search_path locked. This is a no-op if 0011 already created it correctly,
-- but we re-create defensively in case its definition drifted.
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
