-- Course templates — a shared, read-only library every group can clone from.
--
-- Today every group rebuilds JGCC (and any other course) from scratch. The
-- only escape hatch is the JGCC quick-add hardcoded preset, which doesn't
-- scale to a community library. This migration introduces:
--
--   1. A boolean `is_template` flag on `public.courses`. Template courses
--      are SELECTable by every authenticated user regardless of group_id,
--      and only platform admins can mutate them.
--   2. The existing `fn_clone_course` RPC is updated so a clone is allowed
--      when the source course is_template = true (in addition to the
--      original "you're in the source group OR a platform admin" rule).
--
-- Result: a platform admin can flag a course as `is_template = true`, and
-- every signed-in user sees it on /courses with a "Clone into my group"
-- button. Cloning produces a normal (non-template) course inside the
-- caller's group, fully editable by that group.

alter table public.courses
  add column if not exists is_template boolean not null default false;

create index if not exists courses_template_idx
  on public.courses (is_template)
  where is_template = true;

-- Read access: any authenticated user can SELECT a template course.
-- The original "courses in my group" policy still gates non-template
-- courses to group membership.
drop policy if exists "courses templates readable" on public.courses;
create policy "courses templates readable" on public.courses for select
  using (is_template = true);

-- Tees + holes for template courses follow the same pattern: any
-- authenticated user can read them.
drop policy if exists "course_tees templates readable" on public.course_tees;
create policy "course_tees templates readable" on public.course_tees for select
  using (
    course_id in (select id from public.courses where is_template = true)
  );

drop policy if exists "course_holes templates readable" on public.course_holes;
create policy "course_holes templates readable" on public.course_holes for select
  using (
    tee_id in (
      select t.id from public.course_tees t
      join public.courses c on c.id = t.course_id
      where c.is_template = true
    )
  );

-- Mutations on template courses are platform-admin-only.
drop policy if exists "courses templates admin write" on public.courses;
create policy "courses templates admin write" on public.courses for all
  using (
    is_template = true
    and exists (select 1 from public.platform_admins pa where pa.profile_id = auth.uid())
  )
  with check (
    is_template = true
    and exists (select 1 from public.platform_admins pa where pa.profile_id = auth.uid())
  );

-- Update fn_clone_course to permit cloning of templates by any
-- authenticated user. Otherwise unchanged.
create or replace function public.fn_clone_course(p_source_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $CLONE$
declare
  v_uid uuid := auth.uid();
  v_source record;
  v_target_group uuid;
  v_new_course uuid;
  v_old_tee uuid;
  v_new_tee uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select id, group_id, name, city, state, is_template into v_source
    from public.courses where id = p_source_course_id;
  if not found then raise exception 'Source course not found'; end if;

  -- Permission: caller is platform admin, OR member of source group, OR
  -- the source is a template (templates are clone-by-anyone).
  if v_source.is_template is not true
     and not exists (select 1 from public.platform_admins where profile_id = v_uid)
     and not exists (
       select 1 from public.group_members
        where profile_id = v_uid and group_id = v_source.group_id
     ) then
    raise exception 'Not authorized to clone this course';
  end if;

  select group_id into v_target_group
    from public.group_members where profile_id = v_uid limit 1;
  if v_target_group is null then raise exception 'You have no group to clone into'; end if;

  -- The clone is a normal course in the caller's group, never a template.
  insert into public.courses (group_id, name, city, state, is_template)
  values (v_target_group, v_source.name, v_source.city, v_source.state, false)
  returning id into v_new_course;

  for v_old_tee in
    select id from public.course_tees where course_id = p_source_course_id
  loop
    insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    select v_new_course, name, gender, holes, rating, slope, par
      from public.course_tees where id = v_old_tee
    returning id into v_new_tee;

    insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
    select v_new_tee, hole_number, par, stroke_index, yardage
      from public.course_holes where tee_id = v_old_tee;
  end loop;

  return v_new_course;
end;
$CLONE$;

revoke all on function public.fn_clone_course(uuid) from public;
grant execute on function public.fn_clone_course(uuid) to authenticated;
