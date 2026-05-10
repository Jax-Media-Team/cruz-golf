-- 0032 — Two NE Florida placeholder courses populated from scorecards
-- supplied by Patrick on 2026-05-10:
--
--   1. TPC Sawgrass — Stadium Course (par 72, full Blue tee data)
--   2. Deerwood Country Club (par 72, 4 tees with yardage/par/SI;
--      rating/slope flagged 'needs_review' since the card didn't print
--      them and we don't fabricate)
--
-- Per the project's "one tee per color, men's only" course-ingestion
-- rule (CLAUDE.md):
--   - Stadium: Blue tee only this round (other tees can come from a
--     follow-up scorecard or admin entry; the Blue card was the
--     cleanest read).
--   - Deerwood: Gold / Blue / White / Green (no Ladies' duplicates).
--
-- Idempotent — re-runs are no-ops once tees are present.

-- ===================== TPC SAWGRASS STADIUM =====================
do $STADIUM$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Par per scorecard. Front 9 = 36, Back 9 = 36.
  v_pars int[] := array[4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4];
  -- Men's HCP per Stadium scorecard (Gentlemen's Handicap row).
  v_mens_si int[] := array[11, 15, 17, 9, 3, 13, 1, 7, 5, 12, 8, 16, 18, 4, 6, 10, 14, 2];

  -- Blue (Tournament) tee — the only tee with crisp per-hole reads
  -- from the card. Yardages match the published TPC scorecard for
  -- the back tees (7275 total).
  v_blue_yards int[] := array[423, 532, 177, 384, 471, 393, 451, 237, 602,
                              424, 558, 369, 181, 481, 470, 523, 137, 462];
begin
  select id into v_course_id from public.courses
   where is_template = true
     and lower(name) like 'tpc sawgrass — stadium%'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'TPC Stadium template not found; skipping';
    return;
  end if;

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    update public.courses
       set verification_status = 'verified'
     where id = v_course_id and verification_status <> 'verified';
    raise notice 'TPC Stadium already has % tees; verification bumped', v_existing_tee_count;
    return;
  end if;

  -- Seed Blue tee.
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
  values (v_course_id, 'Blue', 'M', 18, 76.8, 155, 72)
  returning id into v_tee_id;
  for i in 1..18 loop
    insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
    values (v_tee_id, i, v_pars[i], v_mens_si[i], v_blue_yards[i]);
  end loop;

  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'TPC Stadium populated: 1 tee (Blue, 76.8/155), 18 holes, status=verified';
end;
$STADIUM$;

-- ===================== DEERWOOD COUNTRY CLUB =====================
do $DEERWOOD$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Par 72. Front 9 = 36 (5,3,4,4,4,4,5,3,4). Back 9 = 36 (4,4,3,5,4,3,4,4,5).
  v_pars int[] := array[5, 3, 4, 4, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 3, 4, 4, 5];
  -- Men's HCP per Deerwood scorecard (Gold/Blue/White/Green row).
  v_mens_si int[] := array[15, 9, 3, 1, 11, 5, 17, 7, 13, 2, 10, 18, 16, 12, 8, 6, 4, 14];

  -- Yardages per scorecard. Rating/slope NOT printed on the card we
  -- have — defaults set to 72.0/113 (handicap-neutral). Admin should
  -- update with actual ratings when available; the 'needs_review'
  -- verification status flags this for follow-up.
  v_tees jsonb := '[
    {"name": "Gold",  "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [566,204,394,437,403,441,545,159,439,473,339,184,531,424,246,465,428,583]},
    {"name": "Blue",  "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [521,182,367,408,355,402,508,148,397,444,317,157,508,393,221,433,401,544]},
    {"name": "White", "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [496,170,343,379,339,375,485,134,373,410,294,145,492,351,191,405,369,508]},
    {"name": "Green", "gender": "M", "rating": 72.0, "slope": 113,
     "yards": [441,152,319,353,312,352,432,124,349,381,282,116,419,319,164,326,331,477]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  i int;
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

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    raise notice 'Deerwood already has % tees; skipping', v_existing_tee_count;
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

  -- 'needs_review' — yardage/par/SI verified from card, rating/slope
  -- placeholders. Admin updates rating/slope when authoritative source
  -- is available, then promotes to 'verified'.
  update public.courses
     set verification_status = 'needs_review'
   where id = v_course_id and verification_status = 'placeholder';

  raise notice 'Deerwood populated: 4 tees (yardage/par/SI verified; rating/slope placeholder), 72 holes, status=needs_review';
end;
$DEERWOOD$;
