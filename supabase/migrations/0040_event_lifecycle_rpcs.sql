-- 0040 — Event lifecycle RPCs with audit-log entries.
--
-- Phase 3c of MULTI_GROUP_DESIGN.md. Wraps event create / archive /
-- restore in SECURITY DEFINER RPCs that:
--
--   1. Enforce commissioner-only writes at the DB layer (defense in
--      depth on top of UI gating + the existing events RLS).
--   2. Write a destructive_audit_log row on every state change. Same
--      pattern as the round / course / press lifecycle RPCs from
--      0027 + 0029 + 0036.
--
-- The /events/new + /events/[id] UI is updated in the same commit to
-- call these RPCs instead of direct table writes for create + archive.
-- Direct inserts to event_games still go through RLS — those are
-- additive + non-destructive + commissioner role is enforced UI-side.
--
-- Idempotent — safe to re-run. Each function is create-or-replace.

-- ===========================================================
-- fn_create_event
-- ===========================================================
create or replace function public.fn_create_event(
  p_group_id uuid,
  p_name text,
  p_kind text,
  p_starts_on date,
  p_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $CREATE$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_role text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Event name is required';
  end if;
  if p_kind not in ('tournament', 'trip', 'club_game') then
    raise exception 'Invalid event kind: %', p_kind;
  end if;
  if p_starts_on is null then
    raise exception 'Start date is required';
  end if;

  -- Commissioner gate: only commissioners of the group can create
  -- events. Platform admins are also allowed via fn_is_platform_admin
  -- for support workflows.
  select role into v_role
    from public.group_members
   where group_id = p_group_id and profile_id = v_uid
   limit 1;
  if v_role is null then
    raise exception 'Not a member of this group';
  end if;
  if v_role <> 'commissioner' and not public.fn_is_platform_admin() then
    raise exception 'Only commissioners can create events';
  end if;

  insert into public.events (
    group_id,
    name,
    kind,
    starts_on,
    ends_on,
    commissioner_profile_id
  )
  values (
    p_group_id,
    trim(p_name),
    p_kind,
    p_starts_on,
    p_ends_on,
    v_uid
  )
  returning id into v_event_id;

  perform public.fn_log_destructive(
    'event.create',
    v_event_id,
    'events',
    p_group_id,
    jsonb_build_object(
      'name', trim(p_name),
      'kind', p_kind,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    )
  );

  return v_event_id;
end;
$CREATE$;
revoke all on function public.fn_create_event(uuid, text, text, date, date) from public;
grant execute on function public.fn_create_event(uuid, text, text, date, date) to authenticated;

-- ===========================================================
-- fn_archive_event (soft delete)
-- ===========================================================
create or replace function public.fn_archive_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ARCHIVE$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_role text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select id, group_id, name, deleted_at into v_event
    from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'Event not found'; end if;
  if v_event.deleted_at is not null then
    return; -- already archived; no-op for idempotency
  end if;

  select role into v_role
    from public.group_members
   where group_id = v_event.group_id and profile_id = v_uid
   limit 1;
  if v_role <> 'commissioner' and not public.fn_is_platform_admin() then
    raise exception 'Only commissioners can archive events';
  end if;

  update public.events
     set deleted_at = now()
   where id = p_event_id;

  perform public.fn_log_destructive(
    'event.archive',
    p_event_id,
    'events',
    v_event.group_id,
    jsonb_build_object('name', v_event.name)
  );
end;
$ARCHIVE$;
revoke all on function public.fn_archive_event(uuid) from public;
grant execute on function public.fn_archive_event(uuid) to authenticated;

-- ===========================================================
-- fn_restore_event
-- ===========================================================
create or replace function public.fn_restore_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $RESTORE$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_role text;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;

  select id, group_id, name, deleted_at into v_event
    from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'Event not found'; end if;
  if v_event.deleted_at is null then
    return; -- already active; no-op for idempotency
  end if;

  select role into v_role
    from public.group_members
   where group_id = v_event.group_id and profile_id = v_uid
   limit 1;
  if v_role <> 'commissioner' and not public.fn_is_platform_admin() then
    raise exception 'Only commissioners can restore events';
  end if;

  update public.events
     set deleted_at = null
   where id = p_event_id;

  perform public.fn_log_destructive(
    'event.restore',
    p_event_id,
    'events',
    v_event.group_id,
    jsonb_build_object('name', v_event.name)
  );
end;
$RESTORE$;
revoke all on function public.fn_restore_event(uuid) from public;
grant execute on function public.fn_restore_event(uuid) to authenticated;
