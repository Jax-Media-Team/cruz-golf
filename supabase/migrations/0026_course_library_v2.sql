-- 0026 — course library v2: verification status + NE Florida priority seeds.
--
-- Patrick (2026-05-10) wants the app to feel local from day one — Cruz
-- Golf is launching with a Northeast Florida user base, and an empty
-- course library reads as enterprise software, not a clubhouse. He
-- explicitly DOES NOT want scraping or TOS-risk ingestion. Acceptable
-- sources: publicly available scorecards, club PDFs, club websites,
-- publicly indexed rating/slope data, OCR from public scorecard images,
-- community-submitted scorecards, seeded course-library tables.
--
-- This migration ships the *infrastructure* + *priority course shells*:
--   1. `verification_status` column on courses with four states.
--   2. `submitted_by` (nullable profile_id) for community attribution.
--   3. RPCs admins use to verify or reject community submissions.
--   4. 12 NE Florida courses seeded as templates with placeholder
--      verification status — recognizable names appear in the library
--      immediately. Tee/hole data lands as it's verified, either
--      manually or via OCR import. No fabricated rating/slope numbers.
--   5. JGCC (already populated by group quick-add) gets bumped to
--      'verified' if a template copy exists.
--
-- The cloning RPC (`fn_clone_course`) is updated to refuse cloning
-- placeholder courses — so a user can SEE that "Pablo Creek" exists in
-- the library, but they can't accidentally import an empty shell into
-- their group. The card UI surfaces a "Help us verify" CTA pointing at
-- the OCR import flow instead.

-- 1. Verification status column.
do $LIBRARY$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'courses'
       and column_name = 'verification_status'
  ) then
    alter table public.courses
      add column verification_status text not null default 'community'
      check (verification_status in (
        'verified',      -- admin-verified, complete, trustworthy
        'community',     -- user-submitted, basic completeness, unmoderated
        'needs_review',  -- flagged for admin review
        'placeholder'    -- name-only stub; cannot be cloned until populated
      ));
  end if;
end;
$LIBRARY$;

-- 2. Submitted-by attribution column.
do $LIBRARY$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'courses'
       and column_name = 'submitted_by'
  ) then
    alter table public.courses
      add column submitted_by uuid references public.profiles(id) on delete set null;
  end if;
end;
$LIBRARY$;

create index if not exists courses_verification_idx
  on public.courses (verification_status)
  where deleted_at is null;

-- 3. Admin verification RPC. Sets a course's verification status; only
--    platform admins (commissioners can't promote courses they may have
--    submitted themselves).
create or replace function public.fn_set_course_verification(
  p_course_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $VERIFY$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if not public.fn_is_platform_admin() then
    raise exception 'Only platform admins can change course verification status';
  end if;
  if p_status not in ('verified', 'community', 'needs_review', 'placeholder') then
    raise exception 'Invalid verification status: %', p_status;
  end if;
  update public.courses
     set verification_status = p_status
   where id = p_course_id;
end;
$VERIFY$;

revoke all on function public.fn_set_course_verification(uuid, text) from public;
grant execute on function public.fn_set_course_verification(uuid, text) to authenticated;

-- 4. Admin template-flag RPC. Used to promote a community course to a
--    cross-group template once its data is trusted.
create or replace function public.fn_set_course_template(
  p_course_id uuid,
  p_is_template boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $TMPL$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if not public.fn_is_platform_admin() then
    raise exception 'Only platform admins can change template status';
  end if;
  update public.courses
     set is_template = coalesce(p_is_template, false)
   where id = p_course_id;
end;
$TMPL$;

revoke all on function public.fn_set_course_template(uuid, boolean) from public;
grant execute on function public.fn_set_course_template(uuid, boolean) to authenticated;

-- 5. Tighten fn_clone_course: refuse cloning a placeholder. Same
--    permission rules as before.
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

  select id, group_id, name, city, state, is_template, verification_status
    into v_source
    from public.courses where id = p_source_course_id;
  if not found then raise exception 'Source course not found'; end if;

  -- Refuse cloning a placeholder — there's no tee/hole data to copy and
  -- the user would end up with an empty shell in their group.
  if coalesce(v_source.verification_status, 'community') = 'placeholder' then
    raise exception 'This course is a placeholder — its scorecard data hasn''t been verified yet. Help us by importing a scorecard photo.';
  end if;

  -- Permission: caller is platform admin, OR member of source group, OR
  -- the source is a template (templates are clone-by-anyone).
  if v_source.is_template is not true
     and not public.fn_is_platform_admin()
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
  insert into public.courses (group_id, name, city, state, is_template, verification_status)
  values (v_target_group, v_source.name, v_source.city, v_source.state, false, 'community')
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

-- 6. NE Florida priority course seeds. Each is created as a template
--    with status='placeholder' so the names appear in the library
--    immediately. Tees/holes will be added when verified. We use a
--    sentinel group_id of NULL would violate the existing not-null
--    constraint; instead, every template is owned by a special
--    'public templates' group seeded below if it doesn't exist.
do $SEED$
declare
  v_template_group uuid;
begin
  -- Find or create the platform-templates group (a marker group that
  -- holds cross-group library courses).
  select id into v_template_group
    from public.groups
   where name = 'Cruz Golf · Course Library' limit 1;

  if v_template_group is null then
    insert into public.groups (name, owner_id)
    values ('Cruz Golf · Course Library',
            (select id from public.profiles order by created_at asc limit 1))
    returning id into v_template_group;
  end if;

  -- Seed each priority course only if it doesn't already exist as a
  -- template. Uses (name, group_id) as the natural key. JGCC is seeded
  -- separately because we already have its full data.
  perform 1 from public.courses
    where is_template = true and lower(name) = lower($name$Ponte Vedra Inn & Club — Ocean Course$name$);
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Ponte Vedra Inn & Club — Ocean Course', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = lower($name$Ponte Vedra Inn & Club — Lagoon Course$name$);
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Ponte Vedra Inn & Club — Lagoon Course', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'timuquana country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Timuquana Country Club', 'Jacksonville', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'deerwood country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Deerwood Country Club', 'Jacksonville', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'sawgrass country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Sawgrass Country Club', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'atlantic beach country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Atlantic Beach Country Club', 'Atlantic Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'marsh landing country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Marsh Landing Country Club', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) like 'tpc sawgrass — stadium%';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'TPC Sawgrass — Stadium Course', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) like 'tpc sawgrass — dye%';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'TPC Sawgrass — Dye''s Valley Course', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'san jose country club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'San Jose Country Club', 'Jacksonville', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'pablo creek club';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Pablo Creek Club', 'Jacksonville', 'FL', true, 'placeholder');
  end if;

  perform 1 from public.courses
    where is_template = true and lower(name) = 'the plantation at ponte vedra beach';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'The Plantation at Ponte Vedra Beach', 'Ponte Vedra Beach', 'FL', true, 'placeholder');
  end if;

  -- JGCC: if no template copy exists yet, create one with placeholder
  -- status (the data we own is per-group, not a template). Bump it to
  -- 'verified' once a platform admin promotes a template copy with the
  -- complete tee/hole data via the admin UI.
  perform 1 from public.courses
    where is_template = true and lower(name) like 'jacksonville golf%';
  if not found then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Jacksonville Golf & Country Club', 'Jacksonville', 'FL', true, 'placeholder');
  end if;
end;
$SEED$;

-- 7. Document the columns for future readers.
comment on column public.courses.verification_status is
  'Library trust signal. verified = admin-verified complete data; community = user-submitted, basic completeness; needs_review = flagged; placeholder = name-only stub, NOT cloneable until tees + holes added. fn_clone_course refuses to clone placeholders.';
comment on column public.courses.submitted_by is
  'Profile that originally submitted this course. Set on community submissions; null for admin-seeded templates.';
