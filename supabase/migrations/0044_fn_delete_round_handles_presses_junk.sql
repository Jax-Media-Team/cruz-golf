-- 0044 — fn_delete_round explicitly deletes round_presses + round_junk_*.
--
-- The 0029 body explicitly deletes settlements / round_games /
-- scorecard_uploads / etc., but skips two newer child tables added
-- after that migration was written:
--
--   - round_presses        (added 2026-05-10 in 0035)
--   - round_junk_config    (added 2026-05-11 in 0041)
--   - round_junk_items     (added 2026-05-11 in 0041)
--
-- Today fn_delete_round works for those tables ONLY because their
-- foreign key to rounds(id) is ON DELETE CASCADE — the final
-- `delete from public.rounds` cascades. That's fragile:
--
--   1. Any future child table author who forgets ON DELETE CASCADE
--      breaks fn_delete_round (the function's own foreign_key_violation
--      handler will catch it, but with a confusing error message that
--      suggests Archive instead of pointing at the real cause).
--   2. The function reads as "delete A, B, C, then rounds" — opaque
--      about presses + junk. New contributors don't know to look at
--      schema for what else cascades.
--
-- This migration replaces fn_delete_round with a version that:
--   - Deletes presses + junk_items + junk_config explicitly.
--   - Keeps the existing FK-violation exception handler as a final
--     defense.
--   - Is otherwise byte-identical to 0029's body (audit hook
--     preserved, permission checks preserved).
--
-- Idempotent (create or replace).

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

  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can delete this round';
  end if;

  begin
    delete from public.manual_entries
      where round_game_id in (select id from public.round_games where round_id = p_round_id);
    delete from public.settlements where round_id = p_round_id;
    delete from public.round_games where round_id = p_round_id;
    delete from public.scorecard_uploads where round_id = p_round_id;
    delete from public.round_wager_acks where round_id = p_round_id;
    delete from public.round_invitees where round_id = p_round_id;
    delete from public.round_invites where round_id = p_round_id;

    -- 2026-05-12: explicit handling of post-0029 child tables.
    -- Defensive: try/catch each because earlier installations may
    -- predate the table (e.g. fresh dev DB with only the events
    -- migrations applied). EXECUTE wrappers swallow "relation does
    -- not exist" so the deletion path stays usable across schema
    -- ages.
    begin
      delete from public.round_junk_items where round_id = p_round_id;
    exception when undefined_table then null;
    end;
    begin
      delete from public.round_junk_config where round_id = p_round_id;
    exception when undefined_table then null;
    end;
    begin
      delete from public.round_presses where round_id = p_round_id;
    exception when undefined_table then null;
    end;

    delete from public.scores
      where round_player_id in (select id from public.round_players where round_id = p_round_id);
    delete from public.round_players where round_id = p_round_id;
    delete from public.round_teams where round_id = p_round_id;
    update public.feedback set round_id = null where round_id = p_round_id;
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

  perform public.fn_log_destructive(
    'round.delete', p_round_id, 'rounds', v_group_id, '{}'::jsonb
  );
end;
$DELETE$;
revoke all on function public.fn_delete_round(uuid) from public;
grant execute on function public.fn_delete_round(uuid) to authenticated;

notify pgrst, 'reload schema';
