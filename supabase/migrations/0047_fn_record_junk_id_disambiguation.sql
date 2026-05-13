-- 0047 — Fix "column reference 'id' is ambiguous" in fn_record_junk.
--
-- Production error (2026-05-13) when a user taps a junk chip:
--
--   ERROR: column reference "id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Root cause: fn_record_junk has `returns table (id uuid, amount_cents
-- integer)`. The OUT-style column `id` becomes an in-scope identifier
-- inside the function body. The line
--
--   select round_id into v_winner_round
--     from public.round_players where id = p_round_player_id;
--
-- references an UNQUALIFIED `id`, which Postgres can no longer
-- disambiguate between the OUT column `id` and the table column
-- `round_players.id`. Postgres 14+ raises 42702 at runtime — the same
-- error Patrick is seeing.
--
-- The fix: qualify every unqualified `id` reference inside the body of
-- fn_record_junk (and, defensively, fn_edit_junk + fn_remove_junk
-- where the same pattern lurks even though their signatures don't
-- declare `id` as an OUT column — qualifying everywhere is harmless
-- and prevents the recurrence Patrick is sick of).
--
-- Also re-qualify the `returning round_junk_items.id into v_item_id`
-- line (already qualified — kept for symmetry) and the
-- `update public.round_junk_items ... where id = p_item_id` lines in
-- the edit + remove functions (qualified to `round_junk_items.id`).
--
-- Idempotent — uses CREATE OR REPLACE. Safe to re-run.
-- Issues NOTIFY pgrst, 'reload schema' at the end to refresh the
-- PostgREST cache (same belt-and-suspenders pattern as 0043).

-- ============================================================
-- fn_record_junk — fully-qualified column refs
-- ============================================================

create or replace function public.fn_record_junk(
  p_round_id uuid,
  p_round_player_id uuid,
  p_hole_number integer,
  p_category text,
  p_custom_label text default null,
  p_note text default null
)
returns table (id uuid, amount_cents integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_member boolean;
  v_winner_round uuid;
  v_amount integer;
  v_item_id uuid;
  v_cfg public.round_junk_config%rowtype;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if p_hole_number < 1 or p_hole_number > 18 then
    raise exception 'hole_number out of range';
  end if;

  -- Round exists + group lookup + status check.
  -- `rounds.id` qualified — avoids any chance of collision with the
  -- OUT column `id`.
  select r.group_id, r.status into v_group_id, v_status
    from public.rounds r where r.id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to add/edit junk';
  end if;

  -- Group membership check.
  select true into v_member
    from public.group_members gm
    where gm.group_id = v_group_id and gm.profile_id = v_uid;
  if not v_member then
    raise exception 'Not a member of this round''s group';
  end if;

  -- Winner's round_player must belong to this round.
  -- THIS IS THE LINE THAT WAS RAISING 42702: `where id = ...` was
  -- ambiguous between the OUT column `id` and `round_players.id`.
  select rp.round_id into v_winner_round
    from public.round_players rp where rp.id = p_round_player_id;
  if v_winner_round is null or v_winner_round <> p_round_id then
    raise exception 'Winner is not in this round';
  end if;

  -- Config must exist + the category must be either active OR custom.
  select * into v_cfg from public.round_junk_config rjc
    where rjc.round_id = p_round_id;
  if not found then
    raise exception 'Junk is not enabled for this round';
  end if;
  if p_category <> 'custom' and not (p_category = any(v_cfg.active_categories)) then
    raise exception 'Category % is not enabled for this round', p_category;
  end if;
  if p_category = 'custom' and (p_custom_label is null or trim(p_custom_label) = '') then
    raise exception 'Custom junk requires a label';
  end if;

  -- Server-authoritative pricing.
  v_amount := public.fn_compute_junk_amount(p_round_id, p_category, p_round_player_id);

  insert into public.round_junk_items (
    round_id, round_player_id, hole_number, category,
    custom_label, amount_cents, note, created_by
  ) values (
    p_round_id, p_round_player_id, p_hole_number, p_category,
    nullif(trim(coalesce(p_custom_label, '')), ''),
    v_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    v_uid
  ) returning round_junk_items.id into v_item_id;

  perform public.fn_log_destructive(
    'junk.record',
    v_item_id,
    'round_junk_items',
    v_group_id,
    jsonb_build_object(
      'round_id', p_round_id,
      'round_player_id', p_round_player_id,
      'hole_number', p_hole_number,
      'category', p_category,
      'custom_label', p_custom_label,
      'amount_cents', v_amount
    )
  );

  -- Explicit column aliases on the return — keeps the OUT columns
  -- distinct from the local variable names, no chance of recursion
  -- into the same ambiguity that bit the SELECT above.
  return query select v_item_id as id, v_amount as amount_cents;
end;
$$;
revoke all on function public.fn_record_junk(uuid, uuid, integer, text, text, text) from public;
grant execute on function public.fn_record_junk(uuid, uuid, integer, text, text, text) to authenticated;

-- ============================================================
-- fn_edit_junk — defensive qualification pass
-- ============================================================
-- This function's signature doesn't declare `id` as an OUT column,
-- so it's not bitten by 42702 today. But the body has multiple
-- unqualified `id` references in identical patterns, and we'd rather
-- prevent a future signature change (e.g. someone adds `returns table
-- (id uuid)` to surface the edited item) from re-introducing the
-- exact bug Patrick has hit twice. Cheap to fix, expensive to debug
-- later.

create or replace function public.fn_edit_junk(
  p_item_id uuid,
  p_hole_number integer default null,
  p_category text default null,
  p_custom_label text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.round_junk_items%rowtype;
  v_group_id uuid;
  v_status text;
  v_role text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select * into v_item from public.round_junk_items rji
    where rji.id = p_item_id and rji.deleted_at is null;
  if not found then raise exception 'Junk item not found'; end if;

  select r.group_id, r.status into v_group_id, v_status
    from public.rounds r where r.id = v_item.round_id;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to edit junk';
  end if;

  select gm.role into v_role from public.group_members gm
    where gm.group_id = v_group_id and gm.profile_id = v_uid;
  if v_role is null then
    raise exception 'Not a member of this round''s group';
  end if;
  if v_role <> 'commissioner' and v_item.created_by <> v_uid then
    raise exception 'Only the commissioner or original recorder can edit this item';
  end if;

  update public.round_junk_items as rji set
    hole_number = coalesce(p_hole_number, rji.hole_number),
    category = coalesce(p_category, rji.category),
    custom_label = case
      when p_custom_label is null then rji.custom_label
      else nullif(trim(p_custom_label), '')
    end,
    note = case
      when p_note is null then rji.note
      else nullif(trim(p_note), '')
    end
  where rji.id = p_item_id;

  perform public.fn_log_destructive(
    'junk.edit',
    p_item_id,
    'round_junk_items',
    v_group_id,
    jsonb_build_object(
      'round_id', v_item.round_id,
      'hole_number', coalesce(p_hole_number, v_item.hole_number),
      'category', coalesce(p_category, v_item.category)
    )
  );
end;
$$;
revoke all on function public.fn_edit_junk(uuid, integer, text, text, text) from public;
grant execute on function public.fn_edit_junk(uuid, integer, text, text, text) to authenticated;

-- ============================================================
-- fn_remove_junk — defensive qualification pass (same reasoning)
-- ============================================================

create or replace function public.fn_remove_junk(
  p_item_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.round_junk_items%rowtype;
  v_group_id uuid;
  v_status text;
  v_role text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Removal reason is required';
  end if;

  select * into v_item from public.round_junk_items rji
    where rji.id = p_item_id and rji.deleted_at is null;
  if not found then raise exception 'Junk item not found or already removed'; end if;

  select r.group_id, r.status into v_group_id, v_status
    from public.rounds r where r.id = v_item.round_id;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to remove junk';
  end if;

  select gm.role into v_role from public.group_members gm
    where gm.group_id = v_group_id and gm.profile_id = v_uid;
  if v_role is null or v_role <> 'commissioner' then
    raise exception 'Only the commissioner can remove junk items';
  end if;

  update public.round_junk_items as rji set
    deleted_at = now(),
    deleted_by = v_uid,
    deletion_reason = trim(p_reason)
  where rji.id = p_item_id;

  perform public.fn_log_destructive(
    'junk.remove',
    p_item_id,
    'round_junk_items',
    v_group_id,
    jsonb_build_object(
      'round_id', v_item.round_id,
      'category', v_item.category,
      'amount_cents', v_item.amount_cents,
      'reason', trim(p_reason)
    )
  );
end;
$$;
revoke all on function public.fn_remove_junk(uuid, text) from public;
grant execute on function public.fn_remove_junk(uuid, text) to authenticated;

-- ============================================================
-- Refresh PostgREST cache.
-- ============================================================
notify pgrst, 'reload schema';
