-- 0034 — Timuquana Country Club (Jacksonville, FL).
--
-- Source: scorecard supplied by Patrick on 2026-05-10. Card prints
-- yardages, par, and stroke index for Green/Blue/White/Gold/Red tees
-- but does NOT print rating + slope. Same compliance posture as
-- Deerwood (0032): seed everything we have, mark verification_status
-- 'needs_review', leave rating/slope at neutral defaults until
-- authoritative numbers arrive.
--
-- Per the "one tee per color, men's only" rule: Green / Blue / White /
-- Gold (men's tees). Red (ladies') skipped.
--
-- Idempotent — skips if tees already exist on the placeholder.

do $TIMUQUANA$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Par 72. Front 9 = 36 (4,4,4,5,3,5,4,3,4). Back 9 = 36 (4,4,5,3,4,5,3,4,4).
  v_pars int[] := array[4, 4, 4, 5, 3, 5, 4, 3, 4, 4, 4, 5, 3, 4, 5, 3, 4, 4];

  -- Men's HCP per scorecard.
  -- Front: 13, 5, 11, 3, 15, 1, 7, 17, 9
  -- Back:  4, 18, 2, 16, 12, 8, 14, 6, 10
  v_mens_si int[] := array[13, 5, 11, 3, 15, 1, 7, 17, 9, 4, 18, 2, 16, 12, 8, 14, 6, 10];

  -- Tees + per-hole yardages 1..18.
  -- Rating/slope not printed on card; placeholder 72.0/113 (handicap-
  -- neutral). Admin updates when verified ratings arrive, then promote
  -- verification_status to 'verified'.
  v_tees jsonb := '[
    {"name": "Green", "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [406,430,346,503,201,512,440,156,435,408,341,544,224,378,520,171,450,423]},
    {"name": "Blue",  "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [395,385,336,494,191,481,385,146,399,397,330,534,201,352,493,163,401,390]},
    {"name": "White", "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [365,372,316,455,165,466,370,135,390,343,319,495,186,342,481,152,384,376]},
    {"name": "Gold",  "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [305,341,272,451,141,410,365,123,313,320,257,445,147,284,464,105,328,294]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  i int;
begin
  select id into v_course_id from public.courses
   where is_template = true
     and lower(name) = 'timuquana country club'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'Timuquana template not found; skipping (run 0026 first)';
    return;
  end if;

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    raise notice 'Timuquana already has % tees; skipping', v_existing_tee_count;
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

  -- Yardage/par/SI verified from card, rating/slope placeholder.
  update public.courses
     set verification_status = 'needs_review'
   where id = v_course_id and verification_status = 'placeholder';

  raise notice 'Timuquana populated: 4 tees (yardage/par/SI verified; rating/slope placeholder), 72 holes, status=needs_review';
end;
$TIMUQUANA$;
