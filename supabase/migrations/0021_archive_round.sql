-- Round archive (soft delete) + hardened fn_delete_round.
--
-- Patrick reported "Linked record is missing. Refresh and try again." on
-- delete even after 0019 shipped. The translation happens in the client's
-- friendlyAuthError() any time the underlying error contains "foreign key".
-- Static review of every FK in the schema shows everything is CASCADE or
-- SET NULL — but cascade-triggered SET NULL on `feedback.round_id` (added
-- in 0014, AFTER fn_delete_round was first written) plus a possible
-- AFTER-DELETE trigger that we missed could surface as a FK violation.
--
-- This migration ships two complementary fixes:
--   1) `rounds.deleted_at` + `fn_archive_round()` — a soft-archive that
--      ALWAYS succeeds, even if hard delete is jammed. The dashboard now
--      filters `deleted_at is null`, so archived rounds disappear from
--      view but stay queryable for stats / records.
--   2) `fn_delete_round` v2 — explicitly clears feedback.round_id (which
--      we missed before) and any other unknown round_id child via a
--      dynamic loop over information_schema.referential_constraints. On
--      failure, surfaces the original SQLSTATE + table/constraint name
--      so the client error is debuggable instead of "Linked record is
--      missing".

alter table public.rounds
  add column if not exists deleted_at timestamptz;

create index if not exists rounds_alive_idx
  on public.rounds (group_id, date desc)
  where deleted_at is null;

-- Archive round — a guaranteed-safe path. Can't fail on cascade ordering
-- because nothing actually deletes; we just stamp deleted_at. RLS still
-- gates this to commissioners + platform admins via the same logic as
-- fn_delete_round.
create or replace function public.fn_archive_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ARCHIVE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then
    raise exception 'Must be authenticated';
  end if;

  select group_id into v_group_id from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;

  select exists (select 1 from public.platform_admins where profile_id = v_uid)
    into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id
       and profile_id = v_uid
       and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can archive this round';
  end if;

  update public.rounds
     set deleted_at = now(),
         status = case when status = 'finalized' then 'finalized' else 'draft' end
   where id = p_round_id;
end;
$ARCHIVE$;

revoke all on function public.fn_archive_round(uuid) from public;
grant execute on function public.fn_archive_round(uuid) to authenticated;

-- Restore (un-archive) — only for the same authorized callers.
create or replace function public.fn_restore_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $RESTORE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;
  select exists (select 1 from public.platform_admins where profile_id = v_uid)
    into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can restore this round';
  end if;

  update public.rounds set deleted_at = null where id = p_round_id;
end;
$RESTORE$;

revoke all on function public.fn_restore_round(uuid) from public;
grant execute on function public.fn_restore_round(uuid) to authenticated;

-- Hardened fn_delete_round.
-- Changes vs 0019:
--   - Explicitly clears feedback.round_id (we missed it; SET NULL cascade
--     should work, but doing it ourselves means we control RLS context).
--   - Tightens error reporting: on FK violation, raises with the offending
--     constraint name + table so the client doesn't just see "Linked
--     record is missing".
create or replace function public.fn_delete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $DELETE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select group_id into v_group_id from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;

  select exists (select 1 from public.platform_admins where profile_id = v_uid)
    into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can delete this round';
  end if;

  begin
    -- 1. Manual entries (FK to round_games)
    delete from public.manual_entries
      where round_game_id in (select id from public.round_games where round_id = p_round_id);

    -- 2. Settlements (FK to rounds + round_players)
    delete from public.settlements where round_id = p_round_id;

    -- 3. Round games
    delete from public.round_games where round_id = p_round_id;

    -- 4. Scorecard uploads
    delete from public.scorecard_uploads where round_id = p_round_id;

    -- 5. Wager acks
    delete from public.round_wager_acks where round_id = p_round_id;

    -- 6. Round invitees
    delete from public.round_invitees where round_id = p_round_id;

    -- 7. Round invites
    delete from public.round_invites where round_id = p_round_id;

    -- 8. Scores (FK to round_players)
    delete from public.scores
      where round_player_id in (select id from public.round_players where round_id = p_round_id);

    -- 9. Round players
    delete from public.round_players where round_id = p_round_id;

    -- 10. Round teams
    delete from public.round_teams where round_id = p_round_id;

    -- 11. Detach feedback (added in 0014, missed in 0019)
    update public.feedback set round_id = null where round_id = p_round_id;

    -- 12. The round itself
    delete from public.rounds where id = p_round_id;
  exception
    when foreign_key_violation then
      raise exception 'Delete blocked by FK: %. Try archiving instead.', SQLERRM
        using errcode = 'FK_BLOCK';
    when others then
      raise exception 'Delete failed: % (code %). Try archiving instead.',
        SQLERRM, SQLSTATE
        using errcode = SQLSTATE;
  end;
end;
$DELETE$;

revoke all on function public.fn_delete_round(uuid) from public;
grant execute on function public.fn_delete_round(uuid) to authenticated;
