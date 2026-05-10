-- 0028 — promote the JGCC template placeholder to verified data.
--
-- The 0026 migration seeded "Jacksonville Golf & Country Club" as a
-- placeholder template (name + city/state only). This migration populates
-- it with the 5 tees + 90 holes from `lib/presets/jgcc.ts` and bumps
-- verification_status to 'verified' so any user can clone it from
-- /courses with one tap.
--
-- Data source: the JGCC pro shop (verified 2026-05-10). Same data the
-- group-quick-add JgccQuickAdd component has been writing per-group.
-- Now it's also a one-clone-away cross-group template.
--
-- Idempotent: only inserts tees/holes when none exist on the template
-- course. Re-running is a no-op.

do $JGCC$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Tee definitions: { key, label, rating, slope, gender }
  v_tees jsonb := '[
    {"name": "Black (Tournament)",  "gender": "M", "rating": 73.2, "slope": 138},
    {"name": "Gold (Championship)", "gender": "M", "rating": 71.8, "slope": 133},
    {"name": "Silver (Center)",     "gender": "M", "rating": 70.6, "slope": 120},
    {"name": "Jade (Allowance)",    "gender": "M", "rating": 67.8, "slope": 117},
    {"name": "Cranberry (Forward)", "gender": "F", "rating": 70.4, "slope": 125}
  ]'::jsonb;
  v_tee jsonb;

  -- Pars by hole 1..18 (Out 36 + In 36 = 72)
  v_pars int[] := array[5, 4, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4, 5, 4, 5, 3, 4];
  -- Men's stroke index 1..18
  v_mens_si int[] := array[13, 7, 17, 1, 5, 15, 9, 11, 3, 16, 6, 14, 12, 18, 8, 2, 10, 4];
  -- Ladies' stroke index 1..18 (used for Cranberry)
  v_ladies_si int[] := array[7, 9, 15, 13, 17, 11, 5, 1, 3, 16, 14, 18, 8, 10, 4, 12, 2, 6];

  -- Yardages per tee per hole (1..18)
  v_yards jsonb := '{
    "Black":     [519, 382, 165, 422, 404, 175, 377, 519, 441, 387, 376, 187, 411, 536, 412, 558, 196, 425],
    "Gold":      [500, 367, 157, 404, 392, 167, 362, 504, 428, 373, 361, 177, 392, 509, 392, 538, 177, 385],
    "Silver":    [486, 341, 147, 377, 321, 155, 340, 485, 407, 356, 340, 156, 372, 487, 370, 523, 158, 381],
    "Jade":      [450, 307, 132, 320, 308, 138, 300, 441, 381, 313, 300, 141, 330, 457, 328, 486, 142, 361],
    "Cranberry": [423, 276, 118, 283, 287, 124, 270, 417, 338, 278, 276, 125, 293, 427, 293, 447, 114, 318]
  }'::jsonb;

  v_yard_arr int[];
  v_si int[];
  v_tee_short text;
  i int;
begin
  -- Find the JGCC template course (created as a placeholder in 0026).
  select id into v_course_id
    from public.courses
   where is_template = true
     and lower(name) like 'jacksonville golf%'
     and deleted_at is null
   limit 1;

  if v_course_id is null then
    -- Nothing to do — template doesn't exist (0026 not applied or
    -- already cleaned up).
    raise notice 'JGCC template not found; skipping';
    return;
  end if;

  -- Check whether the course already has tees populated. Idempotency:
  -- if any tee exists, assume the data has already been seeded (or
  -- manually edited) and don't overwrite.
  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;

  if v_existing_tee_count > 0 then
    -- Already populated — just bump verification status if needed.
    update public.courses
       set verification_status = 'verified'
     where id = v_course_id and verification_status <> 'verified';
    raise notice 'JGCC template already has % tees; verification bumped to verified', v_existing_tee_count;
    return;
  end if;

  -- Seed each tee + 18 holes.
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

    -- Determine yardage key by stripping the parenthetical from the tee
    -- name: "Black (Tournament)" → "Black".
    v_tee_short := split_part(v_tee->>'name', ' ', 1);
    v_yard_arr := array(select jsonb_array_elements_text(v_yards->v_tee_short)::int);

    -- Cranberry uses ladies' stroke index; everyone else mens'.
    v_si := case when v_tee_short = 'Cranberry' then v_ladies_si else v_mens_si end;

    for i in 1..18 loop
      insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
      values (v_tee_id, i, v_pars[i], v_si[i], v_yard_arr[i]);
    end loop;
  end loop;

  -- Bump verification status — admin-quality data is now on file.
  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'JGCC template populated: 5 tees, 90 holes, status=verified';
end;
$JGCC$;
