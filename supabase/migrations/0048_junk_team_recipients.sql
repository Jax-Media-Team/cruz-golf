-- 0048 — Team junk: multi-recipient support for partner-game junk.
--
-- Patrick 2026-05-13 #4: "In real games, junk is often won by a team,
-- not just one player. Currently I can only select one player.
-- Example: In 6-6-6, if my partner and I win 3 junk items at $2 each,
-- that should show as team junk and affect both partners appropriately."
--
-- Design (Agent 5 proposal, approved):
--
--   - NEW table `round_junk_item_recipients (item_id, round_player_id)`
--     PK on (item_id, round_player_id). One row per recipient.
--   - NEW column `round_junk_items.is_team_award` boolean default false
--     — denormalized for fast UI rendering (chip color, "team junk"
--     label) without joining recipients on every list render.
--   - `round_junk_items.round_player_id` stays as the "primary
--     recipient" / displayed-author / escalation-scope key. Single
--     source of truth for "who got the birdie."
--   - Backfill: every existing item gets exactly one recipient row
--     (item_id, round_player_id). is_team_award stays false.
--   - Settlement rule: each loser pays `amount_cents` once (regardless
--     of recipient count); pot is split evenly among recipients with
--     odd-cent remainder going to the lowest-id recipient by sort.
--     Engine implementation lives in lib/games/junk.ts.
--
-- Why a JOIN table instead of `round_player_id_b`: adding a single
-- second column locks the model at 2 recipients. Best-ball / scramble
-- can have 3+. JOIN table costs one extra read per junk render
-- (trivial — junk tables are tiny) and supports N-recipient awards
-- for future formats (Wolf lone-wolf, team aggregate variants).
--
-- Idempotent. Safe to re-run.

create table if not exists public.round_junk_item_recipients (
  item_id uuid not null references public.round_junk_items(id) on delete cascade,
  round_player_id uuid not null references public.round_players(id) on delete cascade,
  primary key (item_id, round_player_id)
);

create index if not exists round_junk_item_recipients_item_idx
  on public.round_junk_item_recipients (item_id);
create index if not exists round_junk_item_recipients_rp_idx
  on public.round_junk_item_recipients (round_player_id);

-- Denormalized flag — keeps the "team junk?" check off the JOIN-heavy
-- path for hot UI (live junk panel renders dozens of items, joining
-- recipients per row would compound).
alter table public.round_junk_items
  add column if not exists is_team_award boolean not null default false;

-- Backfill: every existing item gets ONE recipient row equal to its
-- current round_player_id. ON CONFLICT clause makes the migration
-- idempotent — re-running adds no duplicates and never errors.
insert into public.round_junk_item_recipients (item_id, round_player_id)
select i.id, i.round_player_id
  from public.round_junk_items i
  left join public.round_junk_item_recipients r
    on r.item_id = i.id and r.round_player_id = i.round_player_id
 where r.item_id is null
   and i.round_player_id is not null;

-- =============================================================
-- RLS
-- =============================================================
-- Read policy: same group-membership check as round_junk_items.
-- A user can see recipients for any item they can see the item for.
-- Writes are RPC-only (no INSERT/UPDATE/DELETE policies — see RPC
-- below).

alter table public.round_junk_item_recipients enable row level security;

drop policy if exists round_junk_item_recipients_read
  on public.round_junk_item_recipients;

create policy round_junk_item_recipients_read
  on public.round_junk_item_recipients
  for select
  using (
    exists (
      select 1
        from public.round_junk_items i
        join public.rounds r on r.id = i.round_id
        join public.group_members gm
          on gm.group_id = r.group_id and gm.profile_id = auth.uid()
       where i.id = round_junk_item_recipients.item_id
    )
  );

-- =============================================================
-- fn_record_junk — multi-recipient signature
-- =============================================================
-- New parameter `p_recipient_ids uuid[]` (default null). When null,
-- the function falls back to `[p_round_player_id]` for full backwards
-- compatibility with existing clients (they pass no array → solo
-- award, exactly today's behavior).
--
-- When the array has ≥2 entries:
--   - Validates EVERY id belongs to the round (prevents cross-round leakage).
--   - Sets is_team_award = true.
--   - Inserts one row per recipient into the recipients table.

create or replace function public.fn_record_junk(
  p_round_id uuid,
  p_round_player_id uuid,
  p_hole_number integer,
  p_category text,
  p_custom_label text default null,
  p_note text default null,
  p_recipient_ids uuid[] default null
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
  v_recipients uuid[];
  v_invalid_count integer;
  v_rid uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if p_hole_number < 1 or p_hole_number > 18 then
    raise exception 'hole_number out of range';
  end if;

  select r.group_id, r.status into v_group_id, v_status
    from public.rounds r where r.id = p_round_id;
  if not found then raise exception 'Round not found'; end if;
  if v_status = 'finalized' then
    raise exception 'Round is finalized — unfinalize to add/edit junk';
  end if;

  select true into v_member
    from public.group_members gm
    where gm.group_id = v_group_id and gm.profile_id = v_uid;
  if not v_member then
    raise exception 'Not a member of this round''s group';
  end if;

  select rp.round_id into v_winner_round
    from public.round_players rp where rp.id = p_round_player_id;
  if v_winner_round is null or v_winner_round <> p_round_id then
    raise exception 'Winner is not in this round';
  end if;

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

  -- Resolve the recipient list. Null / empty → fall back to solo.
  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null then
    v_recipients := array[p_round_player_id];
  else
    v_recipients := p_recipient_ids;
    -- Validate every recipient belongs to this round.
    select count(*) into v_invalid_count
      from unnest(v_recipients) as r_id
      left join public.round_players rp
        on rp.id = r_id and rp.round_id = p_round_id
     where rp.id is null;
    if v_invalid_count > 0 then
      raise exception 'One or more recipients are not in this round';
    end if;
  end if;

  v_amount := public.fn_compute_junk_amount(p_round_id, p_category, p_round_player_id);

  insert into public.round_junk_items (
    round_id, round_player_id, hole_number, category,
    custom_label, amount_cents, note, created_by, is_team_award
  ) values (
    p_round_id, p_round_player_id, p_hole_number, p_category,
    nullif(trim(coalesce(p_custom_label, '')), ''),
    v_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    v_uid,
    array_length(v_recipients, 1) > 1
  ) returning round_junk_items.id into v_item_id;

  -- Always write at least one recipient row (the primary). Multi-
  -- recipient items write one per recipient.
  foreach v_rid in array v_recipients
  loop
    insert into public.round_junk_item_recipients (item_id, round_player_id)
    values (v_item_id, v_rid)
    on conflict (item_id, round_player_id) do nothing;
  end loop;

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
      'amount_cents', v_amount,
      'is_team_award', array_length(v_recipients, 1) > 1,
      'recipient_count', array_length(v_recipients, 1)
    )
  );

  return query select v_item_id as id, v_amount as amount_cents;
end;
$$;

-- Drop the old single-recipient signature so PostgREST doesn't keep
-- offering it. The new 7-arg version with the optional p_recipient_ids
-- default supersedes it.
drop function if exists public.fn_record_junk(uuid, uuid, integer, text, text, text);

revoke all on function public.fn_record_junk(uuid, uuid, integer, text, text, text, uuid[]) from public;
grant execute on function public.fn_record_junk(uuid, uuid, integer, text, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
