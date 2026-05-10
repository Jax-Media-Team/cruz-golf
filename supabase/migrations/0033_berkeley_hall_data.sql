-- 0033 — Berkeley Hall Club (Bluffton, SC) seeded as a verified template.
--
-- Source: official Berkeley Hall scorecard supplied by Patrick on
-- 2026-05-10 (the "Berkley Hall Club Challenge" tournament card from
-- 12/3/22). Card prints rating + slope per tee, all clean reads.
--
-- This course is NOT on the original NE Florida priority-13 seed
-- (it's a Bluffton, SC course Patrick plays while traveling), so we
-- INSERT a new template row instead of populating an existing
-- placeholder. The course goes into the same "Cruz Golf · Course
-- Library" sentinel group used by the priority-13 templates so any
-- group in the system can clone it from /courses.
--
-- Per the "one tee per color, men's only" course-ingestion rule, we
-- seed the 6 main men's tees (Black / Blue / Member / White / Fazio /
-- Green). We skip the lower 3 (Berkeley Hall / Burgundy / Silver) —
-- those are forward/ladies' tees rarely used by member-member groups.
--
-- Idempotent: re-runs are no-ops once the course exists with tees.

do $BERKELEY$
declare
  v_template_group uuid;
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Par 72. Front 9 = 36, Back 9 = 36.
  v_pars int[] := array[4, 4, 3, 4, 3, 5, 4, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
  -- Men's HCP per scorecard.
  v_mens_si int[] := array[11, 13, 15, 3, 17, 1, 9, 7, 5, 2, 16, 12, 8, 14, 6, 18, 10, 4];

  -- Tees: name + rating + slope + per-hole yardages 1..18.
  v_tees jsonb := '[
    {"name": "Black",  "gender": "M", "rating": 74.9, "slope": 141,
     "yards": [361,435,194,407,179,548,447,452,551,436,236,554,446,326,487,170,567,458]},
    {"name": "Blue",   "gender": "M", "rating": 72.8, "slope": 137,
     "yards": [339,401,183,378,151,527,414,402,539,409,209,527,392,307,434,142,522,432]},
    {"name": "Member", "gender": "M", "rating": 71.1, "slope": 133,
     "yards": [339,374,156,378,151,512,371,364,489,379,187,527,371,307,409,142,522,411]},
    {"name": "White",  "gender": "M", "rating": 70.4, "slope": 128,
     "yards": [315,374,156,349,131,472,371,364,489,379,187,503,371,294,409,123,484,411]},
    {"name": "Fazio",  "gender": "M", "rating": 69.6, "slope": 126,
     "yards": [315,344,156,349,131,472,347,353,489,357,173,503,362,294,381,123,484,366]},
    {"name": "Green",  "gender": "M", "rating": 68.0, "slope": 124,
     "yards": [285,344,124,328,121,403,347,353,454,357,173,476,362,270,381,118,448,366]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  i int;
begin
  -- Find the sentinel template group (created in 0026).
  select id into v_template_group
    from public.groups
   where name = 'Cruz Golf · Course Library' limit 1;
  if v_template_group is null then
    raise notice 'Sentinel template group not found; skipping Berkeley Hall seed';
    return;
  end if;

  -- Find or create the course as a template.
  select id into v_course_id
    from public.courses
   where is_template = true
     and lower(name) = 'berkeley hall club'
     and deleted_at is null
   limit 1;

  if v_course_id is null then
    insert into public.courses (group_id, name, city, state, is_template, verification_status)
    values (v_template_group, 'Berkeley Hall Club', 'Bluffton', 'SC', true, 'verified')
    returning id into v_course_id;
  end if;

  -- Idempotency: skip seeding tees if already populated.
  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    update public.courses
       set verification_status = 'verified'
     where id = v_course_id and verification_status <> 'verified';
    raise notice 'Berkeley Hall already has % tees; verification bumped', v_existing_tee_count;
    return;
  end if;

  for v_tee in select * from jsonb_array_elements(v_tees)
  loop
    insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (
      v_course_id,
      v_tee->>'name',
      v_tee->>'gender',
      18,
      (v_tee->>'rating')::numeric,
      (v_tee->>'slope')::int,
      72
    )
    returning id into v_tee_id;

    v_yard_arr := array(select jsonb_array_elements_text(v_tee->'yards')::int);

    for i in 1..18 loop
      insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
      values (v_tee_id, i, v_pars[i], v_mens_si[i], v_yard_arr[i]);
    end loop;
  end loop;

  raise notice 'Berkeley Hall populated: 6 tees, 108 holes, status=verified';
end;
$BERKELEY$;
