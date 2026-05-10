-- 0038 — The Plantation at Ponte Vedra Beach (Ponte Vedra Beach, FL).
--
-- Source: scorecard supplied by Patrick on 2026-05-10. Original Arnold
-- Palmer design (1986), redesigned by Greg Letsche in 2016.
-- Par 72, 6 men's tees with rating + slope printed on card → seed
-- everything and promote verification_status to 'verified'.
--
-- Per the "one tee per color, men's only" rule (CLAUDE.md): Black,
-- Blue, Green, Gold, Silver, Red. Skipped: combo tees (Black/Blue,
-- Blue/Green, Green/Gold, Gold/Silver, Silver/Red), Family tee, and
-- the Ladies' rating column.
--
-- Front 9: 5,4,3,4,5,4,3,4,4 = 36
-- Back 9:  4,4,3,4,5,4,3,4,5 = 36
-- Men's HCP: 17,7,13,1,9,11,15,3,5,14,12,18,10,4,6,16,2,8
--
-- Course rating / slope (men's, from card):
--   Black  74.3 / 146
--   Blue   71.9 / 132
--   Green  70.0 / 126
--   Gold   67.7 / 119
--   Silver 63.9 / 113
--   Red    62.1 / 108
--
-- Idempotent — skips tee creation if tees already exist on the
-- placeholder; safe to re-run.

do $PLANTATION$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  v_pars int[] := array[5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5];

  v_mens_si int[] := array[17, 7, 13, 1, 9, 11, 15, 3, 5, 14, 12, 18, 10, 4, 6, 16, 2, 8];

  v_tees jsonb := '[
    {"name": "Black",  "gender": "M", "rating": 74.3, "slope": 146,
     "yards": [539,435,206,486,540,426,178,479,390,408,382,200,421,563,382,206,407,493]},
    {"name": "Blue",   "gender": "M", "rating": 71.9, "slope": 132,
     "yards": [510,387,166,407,515,402,170,421,380,385,364,181,407,532,340,168,375,488]},
    {"name": "Green",  "gender": "M", "rating": 70.0, "slope": 126,
     "yards": [485,351,145,370,492,390,159,385,365,350,352,149,380,503,315,142,360,465]},
    {"name": "Gold",   "gender": "M", "rating": 67.7, "slope": 119,
     "yards": [446,338,112,356,470,337,145,342,337,325,337,130,337,482,283,122,326,441]},
    {"name": "Silver", "gender": "M", "rating": 63.9, "slope": 113,
     "yards": [406,296,94,300,417,327,123,311,295,295,324,110,300,413,235,89,277,407]},
    {"name": "Red",    "gender": "M", "rating": 62.1, "slope": 108,
     "yards": [337,243,90,271,384,305,91,279,268,286,298,104,270,377,210,96,256,401]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  i int;
begin
  select id into v_course_id from public.courses
   where is_template = true
     and lower(name) = 'the plantation at ponte vedra beach'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'The Plantation template not found; skipping (run 0026 first)';
    return;
  end if;

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    raise notice 'The Plantation already has % tees; skipping', v_existing_tee_count;
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

  -- Full data verified from official scorecard (rating, slope, yardage,
  -- par, SI all from the printed card) → promote to 'verified'.
  update public.courses
     set verification_status = 'verified'
   where id = v_course_id and verification_status in ('placeholder', 'needs_review');

  raise notice 'The Plantation populated: 6 tees (Black/Blue/Green/Gold/Silver/Red), 108 holes, status=verified';
end;
$PLANTATION$;
