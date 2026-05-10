-- 0037 — Timuquana CC + Deerwood CC: real rating/slope, promote to verified.
--
-- 0032 (Deerwood) and 0034 (Timuquana) seeded yardage / par / stroke
-- index from the scorecards but used 72.0/113 placeholder rating/slope
-- because the cards Patrick had didn't print them. Status was set to
-- 'needs_review' for both.
--
-- Patrick supplied authoritative rating/slope on 2026-05-10:
--
--   Timuquana CC          Green   73.5/130
--                         Blue    71.7/126
--                         White   69.5/123
--                         Gold    66.1/115
--   Deerwood CC           Gold    75.0/139
--                         Blue    72.5/136
--                         White   70.1/135
--                         Green   67.6/125
--
-- This migration just updates the existing tee rows by (course, name)
-- match and bumps both courses to 'verified'. Idempotent — re-running
-- is a no-op.

-- ===================== TIMUQUANA =====================
do $TIMUQUANA$
declare
  v_course_id uuid;
begin
  select id into v_course_id from public.courses
   where is_template = true
     and lower(name) = 'timuquana country club'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'Timuquana template not found; skipping';
    return;
  end if;

  update public.course_tees set rating = 73.5, slope = 130
   where course_id = v_course_id and lower(name) = 'green';
  update public.course_tees set rating = 71.7, slope = 126
   where course_id = v_course_id and lower(name) = 'blue';
  update public.course_tees set rating = 69.5, slope = 123
   where course_id = v_course_id and lower(name) = 'white';
  update public.course_tees set rating = 66.1, slope = 115
   where course_id = v_course_id and lower(name) = 'gold';

  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'Timuquana: 4 tees updated, status=verified';
end;
$TIMUQUANA$;

-- ===================== DEERWOOD =====================
do $DEERWOOD$
declare
  v_course_id uuid;
begin
  select id into v_course_id from public.courses
   where is_template = true
     and lower(name) = 'deerwood country club'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'Deerwood template not found; skipping';
    return;
  end if;

  update public.course_tees set rating = 75.0, slope = 139
   where course_id = v_course_id and lower(name) = 'gold';
  update public.course_tees set rating = 72.5, slope = 136
   where course_id = v_course_id and lower(name) = 'blue';
  update public.course_tees set rating = 70.1, slope = 135
   where course_id = v_course_id and lower(name) = 'white';
  update public.course_tees set rating = 67.6, slope = 125
   where course_id = v_course_id and lower(name) = 'green';

  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'Deerwood: 4 tees updated, status=verified';
end;
$DEERWOOD$;
