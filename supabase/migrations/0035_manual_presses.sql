-- 0035 — Manual presses (commissioner / player adds during a live round).
--
-- The auto-press primitive (lib/games/press.ts) already fires presses
-- when a side falls 2 down with 3+ holes left. Manual presses are the
-- complementary path: a player explicitly opens a press at a chosen
-- hole, the other side acknowledges (or declines), and the press
-- settles at finalize time using the same per-hole match-play logic.
--
-- Design parameters per Patrick (CLAUDE.md "Manual press UI" spec):
--   - Any player in the round can OPEN a press
--   - Opener nominates start_hole + segment + stake (defaults to
--     parent segment's stake)
--   - Other side ACKNOWLEDGES with one tap (any rp on side B)
--   - Until accepted: opener can WITHDRAW; other side can DECLINE
--   - After accepted: binding through finalize unless commissioner
--     unfinalizes the round
--   - Auto-expire 24h after open if not accepted (UI-side check; no cron)
--   - Every state change writes a destructive_audit_log row
--
-- Settlement: fn_clone_course-style — engine reads round_presses where
-- status='accepted', computes per-hole match deltas in [start_hole,
-- end_hole], and applies the loser-pays-stake pot rule. Zero-sum by
-- construction (same rule Nassau auto-presses use).

create table if not exists public.round_presses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  /** Optional reference to the parent game (nassau / best_ball / etc.).
   *  When set, settlement attaches the press to that game's per-game
   *  delta breakdown. Null = press is round-level (rare). */
  game_id uuid references public.round_games(id) on delete cascade,
  /** Display label shown in UI + settlement breakdown. Examples:
   *    "Nassau front · manual press"
   *    "Nassau back · manual press"
   *    "Best ball match · manual press" */
  segment_label text not null,
  /** First hole the press covers (the hole AFTER opener's trigger). */
  start_hole int not null check (start_hole between 1 and 18),
  /** Last hole inclusive — segment's last hole. */
  end_hole int not null check (end_hole between 1 and 18),
  /** Stake in cents — defaults to parent segment's stake. */
  stake_cents int not null check (stake_cents > 0),
  /** Side A: rps on the opener's side. Stored explicitly so settlement
   *  doesn't have to re-derive partnerships at finalize time
   *  (especially relevant for 6-6-6 where partners rotate). */
  side_a_rp_ids uuid[] not null,
  /** Side B: rps on the responder's side. */
  side_b_rp_ids uuid[] not null,
  opened_by_rp_id uuid not null references public.round_players(id) on delete cascade,
  opened_at timestamptz not null default now(),
  /** Set when first opposing-side rp accepts (one ack is enough — like
   *  the existing wager-handshake pattern). */
  accepted_at timestamptz,
  accepted_by_rp_id uuid references public.round_players(id) on delete set null,
  /** Or declined by an opposing-side rp. Mutually exclusive with accepted_at. */
  declined_at timestamptz,
  declined_by_rp_id uuid references public.round_players(id) on delete set null,
  /** Or withdrawn by the opener (only valid before accepted/declined). */
  withdrawn_at timestamptz,
  /** Materialized status for fast queries. Always derivable from the
   *  timestamp columns above; redundant by design. */
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  /** UI-side check: rows older than 24h with status='pending' are
   *  treated as expired. Stored as a column for index efficiency. */
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists round_presses_round_idx
  on public.round_presses (round_id);
create index if not exists round_presses_pending_idx
  on public.round_presses (status, expires_at)
  where status = 'pending';

-- RLS — same group-membership gate as round_games / round_players.
alter table public.round_presses enable row level security;
drop policy if exists "round_presses via round" on public.round_presses;
create policy "round_presses via round" on public.round_presses for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

-- ===========================================================
-- RPC: fn_open_press
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
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  -- Round must exist + be live or pending. Finalized = no new presses.
  select id, group_id, status into v_round
    from public.rounds where id = p_round_id;
  if v_round.id is null then raise exception 'Round not found'; end if;
  if v_round.status not in ('live', 'pending_finalization') then
    raise exception 'Presses can only be opened on live or pending-finalization rounds';
  end if;

  -- Caller must be a player in this round (any rp).
  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = p_round_id
     and (p.profile_id = v_uid)
   limit 1;
  if v_caller_rp_id is null then
    -- Commissioners can also open on behalf of any rp; fall back to
    -- side_a's first rp as the opener.
    if exists (
      select 1 from public.group_members
       where group_id = v_round.group_id
         and profile_id = v_uid
         and role = 'commissioner'
    ) or public.fn_is_platform_admin() then
      v_caller_rp_id := p_side_a_rp_ids[1];
    else
      raise exception 'You are not a player in this round';
    end if;
  end if;

  -- Validate caller is on side A (the side that's opening).
  if not (v_caller_rp_id = any(p_side_a_rp_ids)) then
    raise exception 'Opener must be on side A';
  end if;

  -- Sanity-check sides: non-empty, no overlap, all rps belong to this round.
  if array_length(p_side_a_rp_ids, 1) is null
     or array_length(p_side_b_rp_ids, 1) is null then
    raise exception 'Both sides must have at least one player';
  end if;
  if exists (
    select 1 from unnest(p_side_a_rp_ids) a
     where a = any(p_side_b_rp_ids)
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

  -- Hole bounds + minimum-3-holes-remaining rule.
  if p_start_hole < 1 or p_start_hole > 18
     or p_end_hole < 1 or p_end_hole > 18
     or p_start_hole > p_end_hole then
    raise exception 'Invalid hole range';
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
-- RPC: fn_accept_press
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

  select * into v_press from public.round_presses where id = p_press_id;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;
  if v_press.expires_at < now() then
    update public.round_presses set status = 'expired' where id = p_press_id;
    raise exception 'Press has expired';
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  -- Caller must be on side B (or commissioner / admin override).
  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id
     and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id is null
     or not (v_caller_rp_id = any(v_press.side_b_rp_ids)) then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id
           and profile_id = v_uid
           and role = 'commissioner'
      ) or public.fn_is_platform_admin()
    ) then
      raise exception 'Only side B players or commissioners can accept';
    end if;
    -- Commissioner override: use first rp on side B as the acceptor.
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
-- RPC: fn_decline_press
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

  select * into v_press from public.round_presses where id = p_press_id;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id
     and p.profile_id = v_uid
   limit 1;
  if v_caller_rp_id is null
     or not (v_caller_rp_id = any(v_press.side_b_rp_ids)) then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id
           and profile_id = v_uid
           and role = 'commissioner'
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
-- RPC: fn_withdraw_press (opener only, before accept)
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

  select * into v_press from public.round_presses where id = p_press_id;
  if v_press.id is null then raise exception 'Press not found'; end if;
  if v_press.status <> 'pending' then
    raise exception 'Press is not pending (current status: %)', v_press.status;
  end if;

  select id, group_id into v_round from public.rounds where id = v_press.round_id;

  select rp.id into v_caller_rp_id
    from public.round_players rp
    join public.players p on p.id = rp.player_id
   where rp.round_id = v_press.round_id
     and p.profile_id = v_uid
   limit 1;
  -- Only the opener (or commissioner / admin) can withdraw.
  if v_caller_rp_id <> v_press.opened_by_rp_id then
    if not (
      exists (
        select 1 from public.group_members
         where group_id = v_round.group_id
           and profile_id = v_uid
           and role = 'commissioner'
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

comment on table public.round_presses is
  'Manual presses opened during a live or pending round. Opener picks the start hole + segment + stake, opposing side acks, settlement happens at finalize via the same per-hole match-play primitive auto-presses use. Audit-logged via fn_log_destructive on every state change.';
