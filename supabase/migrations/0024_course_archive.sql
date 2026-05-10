-- 0024 — soft-archive courses (commissioner-only) + duplicate-JGCC cleanup helper.
--
-- Patrick reported a duplicate JGCC course showing up in his group after
-- Quick Add fired post-recursion-fix. We need:
--   1. fn_archive_course / fn_restore_course — soft delete with the same
--      authorization shape as fn_archive_round (commissioner of the
--      course's group, OR platform admin).
--   2. fn_dedupe_jgcc_in_group(group_id) — picks the canonical JGCC copy
--      (the one with the most tees + holes, tiebreak by oldest created_at)
--      and archives the rest. Idempotent and safe — never deletes rows.

create or replace function public.fn_archive_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ARCHIVE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.courses where id = p_course_id;
  if v_group_id is null then return; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can archive this course';
  end if;
  update public.courses set deleted_at = now() where id = p_course_id;
end;
$ARCHIVE$;
revoke all on function public.fn_archive_course(uuid) from public;
grant execute on function public.fn_archive_course(uuid) to authenticated;

create or replace function public.fn_restore_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $RESTORE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.courses where id = p_course_id;
  if v_group_id is null then return; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can restore this course';
  end if;
  update public.courses set deleted_at = null where id = p_course_id;
end;
$RESTORE$;
revoke all on function public.fn_restore_course(uuid) from public;
grant execute on function public.fn_restore_course(uuid) to authenticated;

-- Pick the canonical JGCC copy in a group and archive the others.
-- "Canonical" = the alive copy with the most course_holes (most data),
-- then the oldest created_at as tiebreak. Leaves rounds/scores intact
-- — those reference the archived course rows but they're still readable.
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

  -- Archive every other JGCC in the group.
  update public.courses
     set deleted_at = now()
   where group_id = p_group_id
     and lower(name) like 'jacksonville golf%'
     and id <> v_canonical_id
     and deleted_at is null;
  get diagnostics v_archived_count = row_count;

  return json_build_object(
    'ok', true,
    'canonical', v_canonical_id,
    'archived', v_archived_count
  );
end;
$DEDUPE$;
revoke all on function public.fn_dedupe_jgcc_in_group(uuid) from public;
grant execute on function public.fn_dedupe_jgcc_in_group(uuid) to authenticated;
