-- Clone-course RPC.
--
-- Copies an existing course (and all its tees + course_holes) into the
-- caller's primary group. Useful for "I want JGCC in my group too" without
-- re-entering 18 holes × 5 tees of par/SI/yardage data.
--
-- Caller must be a member of the SOURCE course's group OR a platform admin.
-- The destination course is created in the caller's first group_members
-- group (matches the existing 1-group-per-user assumption).

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

  select id, group_id, name, city, state into v_source
    from public.courses where id = p_source_course_id;
  if not found then raise exception 'Source course not found'; end if;

  -- Permission check: caller must see the source group OR be platform admin.
  if not exists (select 1 from public.platform_admins where profile_id = v_uid)
     and not exists (select 1 from public.group_members where profile_id = v_uid and group_id = v_source.group_id) then
    raise exception 'Not authorized to clone this course';
  end if;

  -- Target group: the caller's first group.
  select group_id into v_target_group
    from public.group_members where profile_id = v_uid limit 1;
  if v_target_group is null then raise exception 'You have no group to clone into'; end if;

  insert into public.courses (group_id, name, city, state)
  values (v_target_group, v_source.name, v_source.city, v_source.state)
  returning id into v_new_course;

  -- Clone every tee and its holes.
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
