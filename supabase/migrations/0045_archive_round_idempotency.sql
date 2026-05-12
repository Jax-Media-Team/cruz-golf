-- 0045 — fn_archive_round idempotency + preserve status across archive.
--
-- Two issues caught in code review (2026-05-12):
--
-- 1. fn_archive_round (0021) unconditionally re-stamps deleted_at =
--    now() on every call. Clicking Archive twice (or two tabs racing)
--    silently overwrites the original archive timestamp. The UI hides
--    the button when isArchived=true so it's not currently reachable,
--    but the RPC should be defensive.
--
-- 2. fn_archive_round forces non-finalized rounds to status='draft':
--      `status = case when status='finalized' then 'finalized' else 'draft' end`
--    A `live` round archived mid-play comes back as draft after restore,
--    losing the original status. The dashboard filters deleted_at IS
--    NULL so archived rounds are invisible to status-based filters
--    regardless — forcing to draft serves no purpose and breaks
--    restore semantics.
--
-- This migration:
--   - Makes fn_archive_round idempotent (only updates when
--     deleted_at IS NULL).
--   - Preserves the round's status across archive — restore brings
--     it back exactly where it was.
--
-- Idempotent (CREATE OR REPLACE FUNCTION).

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

  -- Idempotent: only stamp deleted_at on rows that aren't already
  -- archived. Preserves the original archive timestamp.
  -- Also preserves status unchanged — restore should bring the
  -- round back exactly where it was, not coerce live/pending into
  -- draft.
  update public.rounds
     set deleted_at = now()
   where id = p_round_id
     and deleted_at is null;
end;
$ARCHIVE$;
revoke all on function public.fn_archive_round(uuid) from public;
grant execute on function public.fn_archive_round(uuid) to authenticated;

notify pgrst, 'reload schema';
