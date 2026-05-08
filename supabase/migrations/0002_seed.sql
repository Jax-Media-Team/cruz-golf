-- Optional dev seed.
-- Inserts a complete demo environment: a group ("Saturday Crew"), a course
-- (Jacksonville Golf & Country Club with all five tees), four players, one
-- live round mid-play (with scores entered through hole 14), and one
-- finalized round with settled wagers.
--
-- Run this AFTER you've signed up at least one user account so a profile
-- exists; it links the demo group to the first profile in the table.
--
-- Idempotent: bail out if a "Saturday Crew" group already exists.

do $$
declare
  v_owner uuid := (select id from public.profiles order by created_at limit 1);
  v_group uuid;
  v_course uuid;
  v_tee_blue uuid;
  v_p_cruz uuid; v_p_jeff uuid; v_p_marco uuid; v_p_taylor uuid;
  v_round_live uuid;
  v_round_done uuid;
  v_rp_cruz uuid; v_rp_jeff uuid; v_rp_marco uuid; v_rp_taylor uuid;
  v_dr_cruz uuid; v_dr_jeff uuid; v_dr_marco uuid; v_dr_taylor uuid;
  v_game_nassau uuid; v_game_skins uuid; v_game_bb uuid;
begin
  if v_owner is null then
    raise notice 'No profile found. Sign up first, then re-run seed.';
    return;
  end if;

  if exists (select 1 from public.groups where name = 'Saturday Crew') then
    raise notice 'Saturday Crew already exists; seed skipped.';
    return;
  end if;

  -- Group + commissioner membership
  insert into public.groups (name, owner_id) values ('Saturday Crew', v_owner) returning id into v_group;
  insert into public.group_members (group_id, profile_id, player_id, role)
    values (v_group, v_owner, gen_random_uuid(), 'commissioner');

  -- Course: Jacksonville Golf & Country Club
  insert into public.courses (group_id, name, city, state)
    values (v_group, 'Jacksonville Golf & Country Club', 'Jacksonville', 'FL')
    returning id into v_course;

  -- Black tee (the one we score against in the demo)
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (v_course, 'Black (Tournament)', 'M', 18, 73.2, 138, 72)
    returning id into v_tee_blue;
  -- Other tees
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (v_course, 'Gold (Championship)', 'M', 18, 71.8, 133, 72);
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (v_course, 'Silver (Center)', 'M', 18, 70.6, 120, 72);
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (v_course, 'Jade (Allowance)', 'M', 18, 67.8, 117, 72);
  insert into public.course_tees (course_id, name, gender, holes, rating, slope, par)
    values (v_course, 'Cranberry (Forward)', 'F', 18, 70.4, 125, 72);

  -- Holes for the Black tee (par + men's stroke index from the JGCC scorecard)
  insert into public.course_holes (tee_id, hole_number, par, stroke_index, yardage)
  select v_tee_blue, h, par, si, yard from (
    values
      (1,  5, 13, 519),
      (2,  4,  7, 382),
      (3,  3, 17, 165),
      (4,  4,  3, 422),
      (5,  4, 15, 404),
      (6,  3,  5, 175),
      (7,  4, 11, 377),
      (8,  5,  1, 519),
      (9,  4,  9, 441),
      (10, 4, 16, 387),
      (11, 4,  2, 376),
      (12, 3, 12, 187),
      (13, 4,  8, 411),
      (14, 5, 18, 536),
      (15, 4,  6, 412),
      (16, 5, 14, 558),
      (17, 3, 10, 196),
      (18, 4,  4, 425)
  ) as t(h, par, si, yard);

  -- Players. Cruz is linked to the first profile so the user sees themselves
  -- as Cruz; everyone else is a guest the commissioner added manually.
  insert into public.players (group_id, profile_id, display_name, handicap_index, handicap_index_source, handicap_updated_at, venmo_handle)
    values (v_group, v_owner, 'Cruz', 12.4, 'manual', now(), 'cruz-jax')
    returning id into v_p_cruz;
  insert into public.players (group_id, display_name, handicap_index, handicap_index_source, handicap_updated_at, venmo_handle, is_guest)
    values (v_group, 'Jeff', 8.0, 'manual', now(), 'jeff-the-grinder', true)
    returning id into v_p_jeff;
  insert into public.players (group_id, display_name, handicap_index, handicap_index_source, handicap_updated_at, venmo_handle, is_guest)
    values (v_group, 'Marco', 18.6, 'manual', now(), 'marco-mulligan', true)
    returning id into v_p_marco;
  insert into public.players (group_id, display_name, handicap_index, handicap_index_source, handicap_updated_at, venmo_handle, is_guest)
    values (v_group, 'Taylor', 14.2, 'manual', now(), 'taylor-tee', true)
    returning id into v_p_taylor;

  -- Live round (mid-play, thru 14)
  insert into public.rounds (group_id, course_id, date, holes, status, created_by, pin)
    values (v_group, v_course, current_date, 18, 'live', v_owner, '4218')
    returning id into v_round_live;

  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_live, v_p_cruz,   v_tee_blue, 12.4, 14, 13, 0) returning id into v_rp_cruz;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_live, v_p_jeff,   v_tee_blue,  8.0,  9,  9, 1) returning id into v_rp_jeff;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_live, v_p_marco,  v_tee_blue, 18.6, 21, 20, 2) returning id into v_rp_marco;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_live, v_p_taylor, v_tee_blue, 14.2, 16, 15, 3) returning id into v_rp_taylor;

  -- Hole-by-hole scores through hole 14 for everyone.
  -- Cruz:  5,4,4,5,4,3,5,6,4,5,4,4,4,5
  -- Jeff:  4,4,3,4,4,3,4,5,4,4,4,4,3,5
  -- Marco: 6,5,5,6,5,4,6,7,5,6,5,4,5,6
  -- Taylor:5,5,4,5,4,3,5,6,4,5,5,3,4,5
  insert into public.scores (round_player_id, hole_number, gross, updated_by)
    select v_rp_cruz, h, g, v_owner from (
      values (1,5),(2,4),(3,4),(4,5),(5,4),(6,3),(7,5),(8,6),(9,4),(10,5),(11,4),(12,4),(13,4),(14,5)
    ) t(h, g);
  insert into public.scores (round_player_id, hole_number, gross, updated_by)
    select v_rp_jeff, h, g, v_owner from (
      values (1,4),(2,4),(3,3),(4,4),(5,4),(6,3),(7,4),(8,5),(9,4),(10,4),(11,4),(12,4),(13,3),(14,5)
    ) t(h, g);
  insert into public.scores (round_player_id, hole_number, gross, updated_by)
    select v_rp_marco, h, g, v_owner from (
      values (1,6),(2,5),(3,5),(4,6),(5,5),(6,4),(7,6),(8,7),(9,5),(10,6),(11,5),(12,4),(13,5),(14,6)
    ) t(h, g);
  insert into public.scores (round_player_id, hole_number, gross, updated_by)
    select v_rp_taylor, h, g, v_owner from (
      values (1,5),(2,5),(3,4),(4,5),(5,4),(6,3),(7,5),(8,6),(9,4),(10,5),(11,5),(12,3),(13,4),(14,5)
    ) t(h, g);

  -- Three games on the live round.
  insert into public.round_games (round_id, game_type, name, stake_cents, allowance_pct, config)
    values (v_round_live, 'nassau', 'Friendly Nassau', 500, 100,
      jsonb_build_object('match_play', true, 'front_stake_cents', 500, 'back_stake_cents', 500, 'overall_stake_cents', 1000, 'presses', 'none'))
    returning id into v_game_nassau;
  insert into public.round_games (round_id, game_type, name, stake_cents, allowance_pct, config)
    values (v_round_live, 'skins_net', 'Net Skins', 0, 100,
      jsonb_build_object('skin_value_cents', 100, 'ties', 'split', 'escalation', 'linear'))
    returning id into v_game_skins;
  insert into public.round_games (round_id, game_type, name, stake_cents, allowance_pct, config)
    values (v_round_live, 'best_ball_net', '2-man Best Ball (Net)', 1000, 85, '{}'::jsonb)
    returning id into v_game_bb;

  -- A separate FINALIZED round from last week, so the season ledger has data.
  insert into public.rounds (group_id, course_id, date, holes, status, created_by, finalized_at)
    values (v_group, v_course, current_date - interval '7 days', 18, 'finalized', v_owner, now() - interval '7 days')
    returning id into v_round_done;

  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_done, v_p_cruz,   v_tee_blue, 12.4, 14, 14, 0) returning id into v_dr_cruz;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_done, v_p_jeff,   v_tee_blue,  8.0,  9,  9, 1) returning id into v_dr_jeff;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_done, v_p_marco,  v_tee_blue, 18.6, 21, 21, 2) returning id into v_dr_marco;
  insert into public.round_players (round_id, player_id, tee_id, handicap_index_used, course_handicap, playing_handicap, display_order)
    values (v_round_done, v_p_taylor, v_tee_blue, 14.2, 16, 16, 3) returning id into v_dr_taylor;

  -- Settlement rows so the ledger renders something interesting.
  -- Net result: Jeff +$25, Cruz +$5, Taylor -$10, Marco -$20.
  insert into public.settlements (round_id, from_round_player_id, to_round_player_id, amount_cents, breakdown)
    values
      (v_round_done, v_dr_marco,  v_dr_jeff,   2000, '[{"game":"Friendly Nassau","amt":2000}]'::jsonb),
      (v_round_done, v_dr_taylor, v_dr_jeff,    500, '[{"game":"Net Skins","amt":500}]'::jsonb),
      (v_round_done, v_dr_taylor, v_dr_cruz,    500, '[{"game":"Best Ball","amt":500}]'::jsonb);
end $$;
