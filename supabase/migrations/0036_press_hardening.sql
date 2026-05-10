-- 0036 — Manual press hardening based on QA agent findings (post-0035).
--
-- Three real fixes:
--   1. Race condition in fn_accept_press / fn_decline_press / fn_withdraw_press —
--      previously used a non-locking SELECT before UPDATE. Two simultaneous
--      acceptances could race and overwrite each other's actor + timestamp.
--      Fix: SELECT ... FOR UPDATE inside the transaction.
--   2. Side-partition validation in fn_open_press — previously allowed
--      sides that don't partition all players (a 4-player round with
--      sides {A1,A2} vs {B1} silently leaves B2 out of press settlement).
--      Fix: require side_a + side_b to cover every rp in the round.
--   3. Press hole-range validation against the round's actual hole count —
--      previously only validated 1–18 unconditionally, so a 9-hole round
--      could open a press on holes 12–18 that would never settle.
--      Fix: clamp start_hole + end_hole to round.holes.
--
-- All three RPCs are re-created in full with the same body + the new
-- safety checks. Idempotent — safe to re-run.

-- ===========================================================
-- fn_open_press — adds partition + round-holes validation
-- ===========================================================
create or replace function public.fn_open_press(
  p_round_id uuid,
  p_game_id uuid,
  p_segment_label text,
  p_start_hole int,
  p_end_hole int,
  p_stake_cents int,
  p_side_a_rp_ids uuid[],
  p_side_b_rp_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $OPEN$
declare
  v_uid uuid := auth.uid();
  v_caller_rp_id uuid;
  v_round record;
  v_press_id uuid;
  v_round_player_count int;
  v_combined_count int;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select id, group_id, status, holes into v_round
    from public.rounds where id = p_round_id;
  if v_round.id is null then raise exception 'Round not found'; end if;
  if v_round.status not in ('live', 'pending_finalization') then
    raise exception 'Presses can only be opened on live or pending-finalization rounds';
  end if;

  -- Caller must be a player in this round (or commissioner / admin).
  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = p_round_id and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id is null then
    if exists (
      select 1 from public.group_members
       where group_id = v_round.group_id and profile_id = v_uid and role = 'commissioner'
    ) or public.fn_is_platform_admin() then
      v_caller_rp_id := p_side_a_rp_ids[1];
    else
      raise exception 'You are not a player in this round';
    end if;
  end if;

  if not (v_caller_rp_id = any(p_side_a_rp_ids)) then
    raise exception 'Opener must be on side A';
  end if;

  if array_length(p_side_a_rp_ids, 1) is null
     or array_length(p_side_b_rp_ids, 1) is null then
    raise exception 'Both sides must have at least one player';
  end if;
  if exists (
    select 1 from unnest(p_side_a_rp_ids) a where a = any(p_side_b_rp_ids)
  ) then
    raise exception 'A player cannot be on both sides';
  end if;
  if (select count(*) from public.round_players
       where id = any(p_side_a_rp_ids || p_side_b_rp_ids)
         and round_id = p_round_id)
     <> array_length(p_side_a_rp_ids || p_side_b_rp_ids, 1)
  then
    raise exception 'All rps must belong to this round';
  end if;

  -- NEW: validate sides partition the entire round. A 4-player round
  -- where someone forgot to include the 4th player would otherwise
  -- silently exclude them from the press settlement, which surprised
  -- users in QA testing.
  select count(*) into v_round_player_count
    from public.round_players where round_id = p_round_id;
  v_combined_count := array_length(p_side_a_rp_ids || p_side_b_rp_ids, 1);
  if v_combined_count <> v_round_player_count then
    raise exception 'Sides must include every player in the round (% players in round, % covered by sides). Add the missing player to one side.',
      v_round_player_count, v_combined_count;
  end if;

  -- Hole bounds: 1..round.holes (not 1..18 unconditionally — was a bug
  -- on 9-hole rounds where holes 10–18 don't exist).
  if p_start_hole < 1 or p_start_hole > v_round.holes
     or p_end_hole < 1 or p_end_hole > v_round.holes
     or p_start_hole > p_end_hole then
    raise exception 'Invalid hole range for a %-hole round', v_round.holes;
  end if;
  if (p_end_hole - p_start_hole + 1) < 3 then
    raise exception 'A press must cover at least 3 holes';
  end if;
  if p_stake_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  insert into public.round_presses (
    round_id, game_id, segment_label, start_hole, end_hole,
    stake_cents, side_a_rp_ids, side_b_rp_ids,
    opened_by_rp_id, status
  )
  values (
    p_round_id, p_game_id, p_segment_label, p_start_hole, p_end_hole,
    p_stake_cents, p_side_a_rp_ids, p_side_b_rp_ids,
    v_caller_rp_id, 'pending'
  )
  returning id into v_press_id;

  perform public.fn_log_destructive(
    'press.open', v_press_id, 'round_presses', v_round.group_id,
    jsonb_build_object(
      'round_id', p_round_id,
      'segment_label', p_segment_label,
      'start_hole', p_start_hole,
      'end_hole', p_end_hole,
      'stake_cents', p_stake_cents
    )
  );

  return v_press_id;
end;
$OPEN$;
revoke all on function public.fn_open_press(uuid, uuid, text, int, int, int, uuid[], uuid[]) from public;
grant execute on function public.fn_open_press(uuid, uuid, text, int, int, int, uuid[], uuid[]) to authenticated;

-- ===========================================================
-- fn_accept_press — adds SELECT ... FOR UPDATE row lock
-- ===========================================================
create or replace function public.fn_accept_press(p_press_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ACCEPT$
declare
  v_uid uuid := auth.uid();
  v_press record;
  v_round record;
  v_caller_rp_id uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  -- FOR UPDATE locks the row inside this transaction. A second
  -- concurrent fn_accept_press call blocks until we commit or roll
  -- back, then reads the post-update row and sees status='accepted'
  -- — failing the pending check below.
  select * into v_press from public.round_presses where id = p_press_id for update;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;
  if v_press.expires_at < now() then
    update public.round_presses set status = 'expired' where id = p_press_id;
    raise exception 'Press has expired';
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id is null
     or not (v_caller_rp_id = any(v_press.side_b_rp_ids)) then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id and profile_id = v_uid and role = 'commissioner'
      ) or public.fn_is_platform_admin()
    ) then
      raise exception 'Only side B players or commissioners can accept';
    end if;
    v_caller_rp_id := v_press.side_b_rp_ids[1];
  end if;

  update public.round_presses
     set status = 'accepted',
         accepted_at = now(),
         accepted_by_rp_id = v_caller_rp_id
   where id = p_press_id;

  perform public.fn_log_destructive(
    'press.accept', p_press_id, 'round_presses', v_round.group_id,
    jsonb_build_object('accepted_by_rp_id', v_caller_rp_id)
  );
end;
$ACCEPT$;
revoke all on function public.fn_accept_press(uuid) from public;
grant execute on function public.fn_accept_press(uuid) to authenticated;

-- ===========================================================
-- fn_decline_press — adds SELECT ... FOR UPDATE row lock
-- ===========================================================
create or replace function public.fn_decline_press(p_press_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $DECLINE$
declare
  v_uid uuid := auth.uid();
  v_press record;
  v_round record;
  v_caller_rp_id uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select * into v_press from public.round_presses where id = p_press_id for update;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id is null
     or not (v_caller_rp_id = any(v_press.side_b_rp_ids)) then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id and profile_id = v_uid and role = 'commissioner'
      ) or public.fn_is_platform_admin()
    ) then
      raise exception 'Only side B players or commissioners can decline';
    end if;
    v_caller_rp_id := v_press.side_b_rp_ids[1];
  end if;

  update public.round_presses
     set status = 'declined',
         declined_at = now(),
         declined_by_rp_id = v_caller_rp_id
   where id = p_press_id;

  perform public.fn_log_destructive(
    'press.decline', p_press_id, 'round_presses', v_round.group_id,
    jsonb_build_object('declined_by_rp_id', v_caller_rp_id)
  );
end;
$DECLINE$;
revoke all on function public.fn_decline_press(uuid) from public;
grant execute on function public.fn_decline_press(uuid) to authenticated;

-- ===========================================================
-- fn_withdraw_press — adds SELECT ... FOR UPDATE row lock
-- ===========================================================
create or replace function public.fn_withdraw_press(p_press_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $WITHDRAW$
declare
  v_uid uuid := auth.uid();
  v_press record;
  v_round record;
  v_caller_rp_id uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select * into v_press from public.round_presses where id = p_press_id for update;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id <> v_press.opened_by_rp_id then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id and profile_id = v_uid and role = 'commissioner'
      ) or public.fn_is_platform_admin()
    ) then
      raise exception 'Only the opener or a commissioner can withdraw a press';
    end if;
  end if;

  update public.round_presses
     set status = 'withdrawn',
         withdrawn_at = now()
   where id = p_press_id;

  perform public.fn_log_destructive(
    'press.withdraw', p_press_id, 'round_presses', v_round.group_id, '{}'::jsonb
  );
end;
$WITHDRAW$;
revoke all on function public.fn_withdraw_press(uuid) from public;
grant execute on function public.fn_withdraw_press(uuid) to authenticated;
