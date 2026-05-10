-- 0025 — round lifecycle: add 'pending_finalization' state.
--
-- Patrick (2026-05-10) flagged that the existing two-step lifecycle
-- (live → finalized) clutters the dashboard with stale "live" rounds
-- whose players have moved on but never tapped Finalize. He explicitly
-- DOES NOT want a midnight auto-close — that creates trust and
-- recoverability risks (late OCR uploads, post-round drink settlements,
-- timezone drift, wager disputes).
--
-- Instead: introduce a 'pending_finalization' state that means
-- "the round is done playing but not yet locked." Pending rounds:
--
--   - DROP OUT of the "Live now" bucket on the dashboard
--   - REMAIN fully editable (scores, games, wagers — same as live)
--   - DO NOT yet have settlements written
--   - PRESERVE every recoverability path
--
-- Transitions are commissioner-driven, not time-driven. The auto-
-- finalize banner already shown when all scores are in will gain a
-- "Move to Awaiting Finalization (review later)" option alongside the
-- existing "Finalize now" button.
--
-- Long-term, optional opt-in heuristics (no edits for X hrs, all scored,
-- no unresolved wagers, commissioner override available) can move
-- rounds to pending automatically. This migration ships the state +
-- the manual transitions only — no automation.

-- 1. Loosen the status check constraint to allow 'pending_finalization'.
--    Postgres requires drop+re-add for a check; the existing constraint
--    is named via the column name, so we drop by-table-discovery to be
--    robust across Postgres minor versions.
do $LIFECYCLE$
declare
  v_constraint_name text;
begin
  select c.conname
    into v_constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'rounds'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%status%draft%live%finalized%'
   limit 1;
  if v_constraint_name is not null then
    execute format('alter table public.rounds drop constraint %I', v_constraint_name);
  end if;
end;
$LIFECYCLE$;

alter table public.rounds
  add constraint rounds_status_check
  check (status in ('draft', 'live', 'pending_finalization', 'finalized'));

-- Optional helper index — most "what's awaiting finalization" queries
-- filter on (group_id, status='pending_finalization'). Partial index so
-- it stays tiny.
create index if not exists rounds_pending_idx
  on public.rounds (group_id, date desc)
  where status = 'pending_finalization' and deleted_at is null;

-- 2. fn_mark_round_pending — commissioner-only transition from live to
--    pending_finalization. Idempotent on already-pending; rejects from
--    finalized (unfinalize first), draft, or archived rounds.
create or replace function public.fn_mark_round_pending(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $PENDING$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_deleted timestamptz;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select group_id, status, deleted_at
    into v_group_id, v_status, v_deleted
    from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;
  if v_deleted is not null then
    raise exception 'Cannot mark an archived round as pending';
  end if;

  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can move a round to pending';
  end if;

  if v_status = 'finalized' then
    raise exception 'Round is already finalized — unfinalize first';
  end if;
  if v_status = 'draft' then
    raise exception 'Round is still a draft — start it first';
  end if;
  -- Idempotent: pending → pending is a no-op.
  if v_status = 'pending_finalization' then return; end if;

  update public.rounds
     set status = 'pending_finalization'
   where id = p_round_id;
end;
$PENDING$;

revoke all on function public.fn_mark_round_pending(uuid) from public;
grant execute on function public.fn_mark_round_pending(uuid) to authenticated;

-- 3. fn_resume_round — commissioner-only transition from pending back
--    to live, used when a player surfaces a missing score or an OCR
--    upload reveals more entries to add. Idempotent on already-live.
create or replace function public.fn_resume_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $RESUME$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_deleted timestamptz;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select group_id, status, deleted_at
    into v_group_id, v_status, v_deleted
    from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;
  if v_deleted is not null then
    raise exception 'Cannot resume an archived round — restore it first';
  end if;

  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can resume a round';
  end if;

  if v_status = 'finalized' then
    raise exception 'Round is finalized — use unfinalize, not resume';
  end if;
  if v_status = 'draft' then
    raise exception 'Round is a draft, not pending';
  end if;
  if v_status = 'live' then return; end if; -- idempotent

  update public.rounds
     set status = 'live'
   where id = p_round_id;
end;
$RESUME$;

revoke all on function public.fn_resume_round(uuid) from public;
grant execute on function public.fn_resume_round(uuid) to authenticated;

-- 4. Document the state machine for future readers.
comment on column public.rounds.status is
  'Lifecycle: draft (created, not yet started) → live (scoring in progress) → pending_finalization (done playing, awaiting commissioner review — STILL EDITABLE) → finalized (locked, settlements written). All transitions audit-trail via finalized_at. Use fn_mark_round_pending / fn_resume_round / [client finalize flow] to transition.';
