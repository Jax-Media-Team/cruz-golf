-- 0030 — promote Ponte Vedra Inn & Club Ocean + Lagoon templates to verified.
--
-- Source: Ponte Vedra Inn & Club official scorecard PDF, supplied by
-- Patrick 2026-05-10. Two courses (Ocean: par 71, Lagoon: par 70).
-- Both were seeded as placeholder templates in 0026; this migration
-- populates them with tees + 18 holes each and bumps verification
-- status to 'verified'.
--
-- Tees included (single-color only — combo tees like Blue/White and
-- White/Green that mix front 9 of one with back 9 of another are NOT
-- modeled here; users who want them can request a follow-up):
--
-- OCEAN (par 71): Black, Gold, Blue, White (M+F), Green (M+F), Red (M+F)
-- LAGOON (par 70): Blue, White (M+F), Green (M+F), Red (M+F)
--
-- Idempotent: each course only seeds tees if none exist. Re-running is
-- a no-op. The course_id is looked up by name match (set up in 0026).

-- ===================== OCEAN COURSE =====================
do $OCEAN$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Ocean is par 71. Front 9 = 36, back 9 = 35.
  v_pars int[] := array[4, 4, 5, 4, 3, 5, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 4, 4];
  -- Men's HCP per scorecard.
  v_mens_si int[] := array[7, 11, 1, 3, 17, 5, 9, 13, 15, 8, 14, 4, 16, 2, 12, 18, 6, 10];
  -- Ladies' HCP per scorecard.
  v_ladies_si int[] := array[9, 13, 3, 1, 15, 5, 7, 11, 17, 14, 16, 2, 18, 4, 10, 6, 8, 12];

  -- Tee specs: name | gender | rating | slope | si_kind | yards[1..18]
  v_tees jsonb := '[
    {"name": "Black",          "gender": "M", "rating": 73.0, "slope": 126, "si": "M",
     "yards": [405,372,556,455,237,525,410,458,144,429,189,575,178,551,417,130,427,369]},
    {"name": "Gold",           "gender": "M", "rating": 72.5, "slope": 125, "si": "M",
     "yards": [405,372,556,432,237,497,410,422,144,429,189,575,178,551,417,130,405,369]},
    {"name": "Blue",           "gender": "M", "rating": 71.0, "slope": 123, "si": "M",
     "yards": [388,364,536,425,211,488,381,412,135,420,174,546,156,527,387,123,370,354]},
    {"name": "White (Men''s)",  "gender": "M", "rating": 68.8, "slope": 118, "si": "M",
     "yards": [370,342,486,404,186,465,358,392,125,375,161,479,141,484,353,113,354,333]},
    {"name": "White (Ladies'')","gender": "F", "rating": 74.3, "slope": 128, "si": "F",
     "yards": [370,342,486,404,186,465,358,392,125,375,161,479,141,484,353,113,354,333]},
    {"name": "Green (Men''s)",  "gender": "M", "rating": 66.4, "slope": 112, "si": "M",
     "yards": [345,330,458,378,160,427,325,372,115,354,145,445,122,421,337,103,313,281]},
    {"name": "Green (Ladies'')","gender": "F", "rating": 71.5, "slope": 121, "si": "F",
     "yards": [345,330,458,378,160,427,325,372,115,354,145,445,122,421,337,103,313,281]},
    {"name": "Red (Men''s)",    "gender": "M", "rating": 64.1, "slope": 107, "si": "M",
     "yards": [314,295,422,322,131,384,313,334,105,300,119,434,99,368,290,93,266,270]},
    {"name": "Red (Ladies'')",  "gender": "F", "rating": 68.7, "slope": 111, "si": "F",
     "yards": [314,295,422,322,131,384,313,334,105,300,119,434,99,368,290,93,266,270]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  v_si int[];
  i int;
begin
  select id into v_course_id
    from public.courses
   where is_template = true
     and lower(name) like '%ponte vedra%ocean%'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'PVIC Ocean template not found; skipping';
    return;
  end if;

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    update public.courses
       set verification_status = 'verified'
     where id = v_course_id and verification_status <> 'verified';
    raise notice 'PVIC Ocean already has % tees; verification bumped', v_existing_tee_count;
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
      71
    )
    returning id into v_tee_id;

    v_yard_arr := array(select jsonb_array_elements_text(v_tee->'yards')::int);
    v_si := case when v_tee->>'si' = 'F' then v_ladies_si else v_mens_si end;

    for i in 1..18 loop
      insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
      values (v_tee_id, i, v_pars[i], v_si[i], v_yard_arr[i]);
    end loop;
  end loop;

  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'PVIC Ocean populated: 9 tees, 162 holes, status=verified';
end;
$OCEAN$;

-- ===================== LAGOON COURSE =====================
do $LAGOON$
declare
  v_course_id uuid;
  v_tee_id uuid;
  v_existing_tee_count int;

  -- Lagoon is par 70. Front 9 = 35, back 9 = 35.
  v_pars int[] := array[4, 4, 3, 4, 3, 4, 5, 3, 5, 3, 4, 5, 3, 5, 4, 4, 3, 4];
  v_mens_si int[] := array[7, 13, 11, 9, 15, 3, 1, 17, 5, 18, 12, 2, 16, 4, 10, 6, 14, 8];
  v_ladies_si int[] := array[11, 17, 7, 5, 13, 9, 1, 15, 3, 16, 4, 2, 18, 8, 12, 10, 14, 6];

  v_tees jsonb := '[
    {"name": "Blue",           "gender": "M", "rating": 68.7, "slope": 120, "si": "M",
     "yards": [396,256,203,380,160,408,517,201,489,145,329,542,171,573,285,342,179,357]},
    {"name": "White (Men''s)",  "gender": "M", "rating": 66.4, "slope": 116, "si": "M",
     "yards": [363,239,160,358,142,390,494,178,464,124,314,519,154,516,272,301,167,329]},
    {"name": "White (Ladies'')","gender": "F", "rating": 71.5, "slope": 131, "si": "F",
     "yards": [363,239,160,358,142,390,494,178,464,124,314,519,154,516,272,301,167,329]},
    {"name": "Green (Men''s)",  "gender": "M", "rating": 64.1, "slope": 109, "si": "M",
     "yards": [328,226,127,326,113,377,471,159,445,110,295,455,136,479,256,278,149,303]},
    {"name": "Green (Ladies'')","gender": "F", "rating": 68.8, "slope": 122, "si": "F",
     "yards": [328,226,127,326,113,377,471,159,445,110,295,455,136,479,256,278,149,303]},
    {"name": "Red (Men''s)",    "gender": "M", "rating": 61.9, "slope": 102, "si": "M",
     "yards": [298,175,98,291,101,324,402,126,382,102,278,392,122,430,205,249,127,268]},
    {"name": "Red (Ladies'')",  "gender": "F", "rating": 65.3, "slope": 112, "si": "F",
     "yards": [298,175,98,291,101,324,402,126,382,102,278,392,122,430,205,249,127,268]}
  ]'::jsonb;

  v_tee jsonb;
  v_yard_arr int[];
  v_si int[];
  i int;
begin
  select id into v_course_id
    from public.courses
   where is_template = true
     and lower(name) like '%ponte vedra%lagoon%'
     and deleted_at is null
   limit 1;
  if v_course_id is null then
    raise notice 'PVIC Lagoon template not found; skipping';
    return;
  end if;

  select count(*) into v_existing_tee_count
    from public.course_tees where course_id = v_course_id;
  if v_existing_tee_count > 0 then
    update public.courses
       set verification_status = 'verified'
     where id = v_course_id and verification_status <> 'verified';
    raise notice 'PVIC Lagoon already has % tees; verification bumped', v_existing_tee_count;
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
      70
    )
    returning id into v_tee_id;

    v_yard_arr := array(select jsonb_array_elements_text(v_tee->'yards')::int);
    v_si := case when v_tee->>'si' = 'F' then v_ladies_si else v_mens_si end;

    for i in 1..18 loop
      insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
      values (v_tee_id, i, v_pars[i], v_si[i], v_yard_arr[i]);
    end loop;
  end loop;

  update public.courses
     set verification_status = 'verified'
   where id = v_course_id;

  raise notice 'PVIC Lagoon populated: 7 tees, 126 holes, status=verified';
end;
$LAGOON$;
