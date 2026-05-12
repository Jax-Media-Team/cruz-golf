-- 0043 — Defensive re-apply of junk RPCs + schema-cache reload.
--
-- Patrick hit this error in production after applying 0041:
--
--   "Could not find the function public.fn_set_junk_config(
--     p_active_categories, p_base_amount_cents, p_custom_categories,
--     p_escalation_scope, p_escalation_step_cents, p_flat_amount_cents,
--     p_mode, p_round_id) in the schema cache"
--
-- The function name + parameter names are identical to what 0041
-- declares, so this is either:
--   (a) 0041 silently partially-applied (some statements failed in the
--       SQL editor and rolled back without surfacing); OR
--   (b) PostgREST's schema cache didn't refresh after the apply.
--
-- This migration does the defensive thing both ways:
--   1. Drops every junk RPC by full signature (idempotent — IF EXISTS).
--   2. Re-creates each function from scratch.
--   3. Re-grants execute to authenticated.
--   4. Issues NOTIFY pgrst, 'reload schema' so PostgREST drops its
--      cached function list and re-reads from pg_proc.
--
-- Also flips the table default mode to 'flat' (Patrick's preference —
-- flat is the more common casual rule than escalating). The engine
-- DEFAULT_JUNK_CONFIG is also being flipped in the same commit.
--
-- Idempotent end-to-end. Safe to run alongside or instead of 0041.

-- ============================================================
-- Step 1 — Drop existing junk RPCs (if any).
-- ============================================================

drop function if exists public.fn_set_junk_config(uuid, text[], text, integer, integer, integer, text, jsonb);
drop function if exists public.fn_record_junk(uuid, uuid, integer, text, text, text);
drop function if exists public.fn_edit_junk(uuid, integer, text, text, text);
drop function if exists public.fn_remove_junk(uuid, text);
drop function if exists public.fn_compute_junk_amount(uuid, text, uuid);

-- ============================================================
-- Step 2 — Flip the default mode to 'flat' (Patrick's preference,
--          2026-05-12). New rounds that enable junk without
--          specifying a mode get flat $2 per item instead of
--          escalating. Existing rows are NOT touched — only the
--          DEFAULT applies to fresh inserts.
-- ============================================================

alter table if exists public.round_junk_config
  alter column mode set default 'flat';

-- ============================================================
-- Step 3 — fn_compute_junk_amount (helper used by fn_record_junk)
-- ============================================================

create or replace function public.fn_compute_junk_amount(
  p_round_id uuid,
  p_category text,
  p_round_player_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg public.round_junk_config%rowtype;
  v_prior_count integer;
  v_base integer;
  v_step integer;
begin
  select * into v_cfg from public.round_junk_config where round_id = p_round_id;
  if not found then return 0; end if;

  if v_cfg.mode = 'flat' then
    return coalesce(v_cfg.flat_amount_cents, 0);
  end if;

  if v_cfg.escalation_scope = 'per_category' then
    select count(*) into v_prior_count
      from public.round_junk_items
      where round_id = p_round_id
        and category = p_category
        and deleted_at is null;
  elsif v_cfg.escalation_scope = 'per_player_per_category' then
    select count(*) into v_prior_count
      from public.round_junk_items
      where round_id = p_round_id
        and category = p_category
        and round_player_id = p_round_player_id
        and deleted_at is null;
  else
    select count(*) into v_prior_count
      from public.round_junk_items
      where round_id = p_round_id
        and deleted_at is null;
  end if;

  v_base := coalesce(v_cfg.base_amount_cents, 0);
  v_step := coalesce(v_cfg.escalation_step_cents, 0);
  return v_base + v_prior_count * v_step;
end;
$$;
revoke all on function public.fn_compute_junk_amount(uuid, text, uuid) from public;
grant execute on function public.fn_compute_junk_amount(uuid, text, uuid) to authenticated;

-- ============================================================
-- Step 4 — fn_set_junk_config
-- ============================================================

create or replace function public.fn_set_junk_config(
  p_round_id uuid,
  p_active_categories text[],
  p_mode text,
  p_flat_amount_cents integer,
  p_base_amount_cents integer,
  p_escalation_step_cents integer,
  p_escalation_scope text,
  p_custom_categories jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_role text;
  v_status text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if p_mode not in ('flat', 'escalating') then
    raise exception 'Invalid mode: %', p_mode;
  end if;

  select group_id, status into v_group_id, v_status
    from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize before editing junk config';
  end if;

  select role into v_role from public.group_members
    where group_id = v_group_id and profile_id = v_uid;
  if v_role is null or v_role <> 'commissioner' then
    raise exception 'Only the commissioner can change junk config';
  end if;

  insert into public.round_junk_config (
    round_id, active_categories, mode,
    flat_amount_cents, base_amount_cents, escalation_step_cents,
    escalation_scope, custom_categories, updated_at, updated_by
  ) values (
    p_round_id,
    coalesce(p_active_categories, array[]::text[]),
    p_mode,
    p_flat_amount_cents,
    p_base_amount_cents,
    p_escalation_step_cents,
    p_escalation_scope,
    p_custom_categories,
    now(),
    v_uid
  )
  on conflict (round_id) do update set
    active_categories = excluded.active_categories,
    mode = excluded.mode,
    flat_amount_cents = excluded.flat_amount_cents,
    base_amount_cents = excluded.base_amount_cents,
    escalation_step_cents = excluded.escalation_step_cents,
    escalation_scope = excluded.escalation_scope,
    custom_categories = excluded.custom_categories,
    updated_at = now(),
    updated_by = v_uid;

  perform public.fn_log_destructive(
    'junk.config_change',
    p_round_id,
    'rounds',
    v_group_id,
    jsonb_build_object(
      'active_categories', p_active_categories,
      'mode', p_mode,
      'flat_amount_cents', p_flat_amount_cents,
      'base_amount_cents', p_base_amount_cents,
      'escalation_step_cents', p_escalation_step_cents,
      'escalation_scope', p_escalation_scope
    )
  );
end;
$$;
revoke all on function public.fn_set_junk_config(uuid, text[], text, integer, integer, integer, text, jsonb) from public;
grant execute on function public.fn_set_junk_config(uuid, text[], text, integer, integer, integer, text, jsonb) to authenticated;

-- ============================================================
-- Step 5 — fn_record_junk
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

  select group_id, status into v_group_id, v_status
    from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to add/edit junk';
  end if;

  select true into v_member
    from public.group_members
    where group_id = v_group_id and profile_id = v_uid;
  if not v_member then
    raise exception 'Not a member of this round''s group';
  end if;

  select round_id into v_winner_round
    from public.round_players where id = p_round_player_id;
  if v_winner_round is null or v_winner_round <> p_round_id then
    raise exception 'Winner is not in this round';
  end if;

  select * into v_cfg from public.round_junk_config where round_id = p_round_id;
  if not found then
    raise exception 'Junk is not enabled for this round';
  end if;
  if p_category <> 'custom' and not (p_category = any(v_cfg.active_categories)) then
    raise exception 'Category % is not enabled for this round', p_category;
  end if;
  if p_category = 'custom' and (p_custom_label is null or trim(p_custom_label) = '') then
    raise exception 'Custom junk requires a label';
  end if;

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

  return query select v_item_id, v_amount;
end;
$$;
revoke all on function public.fn_record_junk(uuid, uuid, integer, text, text, text) from public;
grant execute on function public.fn_record_junk(uuid, uuid, integer, text, text, text) to authenticated;

-- ============================================================
-- Step 6 — fn_edit_junk
-- ============================================================

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

  select * into v_item from public.round_junk_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'Junk item not found'; end if;

  select group_id, status into v_group_id, v_status from public.rounds where id = v_item.round_id;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to edit junk';
  end if;

  select role into v_role from public.group_members
    where group_id = v_group_id and profile_id = v_uid;
  if v_role is null then
    raise exception 'Not a member of this round''s group';
  end if;
  if v_role <> 'commissioner' and v_item.created_by <> v_uid then
    raise exception 'Only the commissioner or original recorder can edit this item';
  end if;

  update public.round_junk_items set
    hole_number = coalesce(p_hole_number, hole_number),
    category = coalesce(p_category, category),
    custom_label = case
      when p_custom_label is null then custom_label
      else nullif(trim(p_custom_label), '')
    end,
    note = case
      when p_note is null then note
      else nullif(trim(p_note), '')
    end
  where id = p_item_id;

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
-- Step 7 — fn_remove_junk
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

  select * into v_item from public.round_junk_items where id = p_item_id and deleted_at is null;
  if not found then raise exception 'Junk item not found or already removed'; end if;

  select group_id, status into v_group_id, v_status from public.rounds where id = v_item.round_id;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to remove junk';
  end if;

  select role into v_role from public.group_members
    where group_id = v_group_id and profile_id = v_uid;
  if v_role is null or v_role <> 'commissioner' then
    raise exception 'Only the commissioner can remove junk items';
  end if;

  update public.round_junk_items set
    deleted_at = now(),
    deleted_by = v_uid,
    deletion_reason = trim(p_reason)
  where id = p_item_id;

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
-- Step 8 — Force PostgREST to drop its cached function list and
--          re-read from pg_proc. The Supabase event-trigger
--          auto-reload SHOULD have fired on every CREATE OR REPLACE
--          above, but Patrick hit a "could not find" error after
--          0041 anyway. This NOTIFY is the bulletproof finishing
--          move.
-- ============================================================

notify pgrst, 'reload schema';
