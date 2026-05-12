-- 0041 — Junk side-bet schema + RPCs.
--
-- Real-world ask from a tester (2026-05-11): "we play $2 escalating
-- junk and it's a pain to track manually." Patrick approved the
-- shape in docs/JUNK_DESIGN.md.
--
-- Two new tables:
--   - round_junk_config — per-round opt-in + mode + amounts.
--     Optional row; its absence means junk is OFF for the round.
--   - round_junk_items — one row per recorded junk event. Soft-
--     delete via deleted_at.
--
-- Four SECURITY DEFINER RPCs:
--   - fn_record_junk(...) — server-side authoritative pricing.
--     Caller passes the category + hole + winner; the function
--     computes the amount based on prior items and the round's
--     config. Audit log on every record.
--   - fn_edit_junk(...) — edit a recorded item (note, hole,
--     category, custom_label). Commissioner OR original recorder.
--     Refuses edits when round is finalized.
--   - fn_remove_junk(...) — soft-delete. Commissioner only.
--     Refuses when round is finalized (admin must unfinalize first).
--   - fn_set_junk_config(...) — commissioner upserts the round's
--     junk config.
--
-- Settlement: pure-function in lib/games/junk.ts. The finalize view
-- reads round_junk_items WHERE deleted_at IS NULL and feeds them
-- through settleJunk(). Frozen amounts persist across edits.
--
-- Idempotent — safe to re-run. Tables use IF NOT EXISTS; functions
-- are create-or-replace.

-- ===========================================================
-- round_junk_config
-- ===========================================================

create table if not exists public.round_junk_config (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  active_categories text[] not null default array[
    'birdie', 'eagle', 'greenie', 'sandy', 'chip_in', 'poley', 'pinny'
  ]::text[],
  mode text not null default 'escalating'
    check (mode in ('flat', 'escalating')),
  flat_amount_cents integer check (flat_amount_cents is null or flat_amount_cents >= 0),
  base_amount_cents integer default 200 check (base_amount_cents is null or base_amount_cents >= 0),
  escalation_step_cents integer default 200 check (escalation_step_cents is null or escalation_step_cents >= 0),
  escalation_scope text default 'per_round'
    check (escalation_scope is null or escalation_scope in ('per_round', 'per_category', 'per_player_per_category')),
  custom_categories jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.round_junk_config enable row level security;

-- Read: any member of the round's group can read junk config.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'round_junk_config'
      and policyname = 'round_junk_config_read'
  ) then
    create policy round_junk_config_read on public.round_junk_config
      for select to authenticated
      using (
        exists (
          select 1
          from public.rounds r
          join public.group_members gm on gm.group_id = r.group_id
          where r.id = round_junk_config.round_id
            and gm.profile_id = auth.uid()
        )
      );
  end if;
end$$;

-- No INSERT / UPDATE / DELETE policies — writes go through fn_set_junk_config.

-- ===========================================================
-- round_junk_items
-- ===========================================================

create table if not exists public.round_junk_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  round_player_id uuid not null references public.round_players(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  category text not null,
  custom_label text,
  -- Frozen amount at record time. Server-authoritative — clients
  -- can never supply this.
  amount_cents integer not null check (amount_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  deletion_reason text
);

create index if not exists round_junk_items_round_idx
  on public.round_junk_items (round_id)
  where deleted_at is null;
create index if not exists round_junk_items_round_player_idx
  on public.round_junk_items (round_player_id)
  where deleted_at is null;
-- Chronological ordering for escalation math + audit display.
create index if not exists round_junk_items_round_created_idx
  on public.round_junk_items (round_id, created_at)
  where deleted_at is null;

alter table public.round_junk_items enable row level security;

-- Read: any member of the round's group can read junk items.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'round_junk_items'
      and policyname = 'round_junk_items_read'
  ) then
    create policy round_junk_items_read on public.round_junk_items
      for select to authenticated
      using (
        exists (
          select 1
          from public.rounds r
          join public.group_members gm on gm.group_id = r.group_id
          where r.id = round_junk_items.round_id
            and gm.profile_id = auth.uid()
        )
      );
  end if;
end$$;

-- No INSERT / UPDATE / DELETE policies — writes go through RPCs.

-- ===========================================================
-- Helper: compute amount for a new junk item
-- ===========================================================
-- Mirrors lib/games/junk.ts:computeJunkAmount. Reads the round's
-- config + the chronologically-prior non-deleted items to derive
-- the right amount. Returns 0 if the config is missing or disabled.
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

  -- Escalating mode: count prior items by scope.
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
    -- Default: per_round.
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

-- ===========================================================
-- fn_set_junk_config — commissioner upserts the round's config
-- ===========================================================
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

-- ===========================================================
-- fn_record_junk — record a junk event with server-side pricing
-- ===========================================================
-- Caller passes the round_player_id (winner), hole, category, and
-- optional note / custom_label. The function:
--   1. Verifies caller is in the round's group.
--   2. Refuses if round is finalized.
--   3. Computes the authoritative amount via fn_compute_junk_amount.
--   4. Inserts the item.
--   5. Writes an audit log entry.
--   6. Returns the new item id + frozen amount so the client can
--      update its UI.
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
  select group_id, status into v_group_id, v_status
    from public.rounds where id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to add/edit junk';
  end if;

  -- Group membership (any member can record junk, not commissioner-only —
  -- matches the score-entry surface where any player can save scores).
  select true into v_member
    from public.group_members
    where group_id = v_group_id and profile_id = v_uid;
  if not v_member then
    raise exception 'Not a member of this round''s group';
  end if;

  -- Winner's round_player must belong to this round.
  select round_id into v_winner_round
    from public.round_players where id = p_round_player_id;
  if v_winner_round is null or v_winner_round <> p_round_id then
    raise exception 'Winner is not in this round';
  end if;

  -- Config must exist + the category must be either active OR custom.
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

  return query select v_item_id, v_amount;
end;
$$;
revoke all on function public.fn_record_junk(uuid, uuid, integer, text, text, text) from public;
grant execute on function public.fn_record_junk(uuid, uuid, integer, text, text, text) to authenticated;

-- ===========================================================
-- fn_edit_junk — edit a recorded item
-- ===========================================================
-- Allowed for: commissioner OR the original recorder, while round
-- is not finalized. Amount cannot be edited directly (it's the
-- frozen-pricing invariant). To re-price, remove and re-record.
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

-- ===========================================================
-- fn_remove_junk — soft-delete a recorded item
-- ===========================================================
-- Commissioner-only. Refused when round is finalized.
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
