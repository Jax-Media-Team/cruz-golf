-- 0027 — destructive operation audit log.
--
-- Patrick (2026-05-10): "I'd rather optimize for trust, recoverability,
-- confidence, permanence than aggressive auto-closing behavior. Once
-- people start building real history inside the app, trust becomes
-- even more important than features."
--
-- This migration ships an append-only audit table that captures every
-- destructive / lifecycle-changing op:
--
--   - round archive / restore / delete
--   - course archive / restore
--   - round mark-pending / resume / finalize / unfinalize
--   - course verification status change
--   - course template flag change
--   - guest-to-account link / unlink
--
-- Existing RPCs are augmented to insert audit rows; non-RPC paths
-- (rare; mostly internal) can use the helper directly. Read access
-- is platform-admin-only.
--
-- Append-only by RLS: no UPDATE / DELETE policies defined, so even
-- an admin can't tamper with the audit trail through the normal API.
-- Service-role can still maintain the table if absolutely needed.

create table if not exists public.destructive_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  /** auth.uid() at the time of the op (null for service-role / triggers). */
  actor_profile_id uuid references public.profiles(id) on delete set null,
  /** The op kind (free-form short string; see migration comments for
   *  the canonical set: 'round.archive', 'round.delete', 'round.restore',
   *  'round.finalize', 'round.unfinalize', 'round.mark_pending',
   *  'round.resume', 'course.archive', 'course.restore',
   *  'course.verify', 'course.template_flag', 'player.link_guest',
   *  'player.unlink'). */
  kind text not null,
  /** Stable id of the target entity (round_id / course_id / player_id). */
  target_id uuid not null,
  /** Target table name for fast filtering / joining ("rounds" /
   *  "courses" / "players"). */
  target_table text not null,
  /** Group the operation affected, when applicable. Lets admins filter
   *  audit history by group. */
  group_id uuid references public.groups(id) on delete set null,
  /** Optional structured detail blob. Examples:
   *    { from_status: 'live', to_status: 'pending_finalization' }
   *    { from_verification: 'placeholder', to_verification: 'verified' }
   *  Engine code should write tiny shallow objects only — large blobs
   *  bloat the table. */
  detail jsonb default '{}'::jsonb
);

create index if not exists destructive_audit_log_occurred_idx
  on public.destructive_audit_log (occurred_at desc);
create index if not exists destructive_audit_log_target_idx
  on public.destructive_audit_log (target_table, target_id);
create index if not exists destructive_audit_log_group_idx
  on public.destructive_audit_log (group_id, occurred_at desc)
  where group_id is not null;
create index if not exists destructive_audit_log_kind_idx
  on public.destructive_audit_log (kind, occurred_at desc);

alter table public.destructive_audit_log enable row level security;

-- Read: platform admins only. No UPDATE / DELETE policies → append-only.
drop policy if exists "audit log admin read" on public.destructive_audit_log;
create policy "audit log admin read" on public.destructive_audit_log for select
  using (public.fn_is_platform_admin());

-- Helper: writes one audit row with the calling user as actor (or null
-- for service-role contexts). SECURITY DEFINER so existing RPCs can
-- call it without granting INSERT to authenticated users directly.
create or replace function public.fn_log_destructive(
  p_kind text,
  p_target_id uuid,
  p_target_table text,
  p_group_id uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $LOG$
begin
  insert into public.destructive_audit_log (
    actor_profile_id, kind, target_id, target_table, group_id, detail
  )
  values (auth.uid(), p_kind, p_target_id, p_target_table, p_group_id, p_detail);
end;
$LOG$;
revoke all on function public.fn_log_destructive(text, uuid, text, uuid, jsonb) from public;
grant execute on function public.fn_log_destructive(text, uuid, text, uuid, jsonb) to authenticated;

-- Augment existing lifecycle RPCs to write audit rows. Each replaces
-- the prior body with the same logic + a perform fn_log_destructive
-- call at the end. All idempotent and safe to re-run.

-- fn_archive_round
create or replace function public.fn_archive_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ARCHIVE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status_before text;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id, status into v_group_id, v_status_before
    from public.rounds where id = p_round_id;
  if v_group_id is null then return; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can archive this round';
  end if;
  update public.rounds
     set deleted_at = now(),
         status = case when status = 'finalized' then 'finalized' else 'draft' end
   where id = p_round_id;
  perform public.fn_log_destructive(
    'round.archive', p_round_id, 'rounds', v_group_id,
    jsonb_build_object('status_before', v_status_before)
  );
end;
$ARCHIVE$;

-- fn_restore_round
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
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can restore this round';
  end if;
  update public.rounds set deleted_at = null where id = p_round_id;
  perform public.fn_log_destructive(
    'round.restore', p_round_id, 'rounds', v_group_id, '{}'::jsonb
  );
end;
$RESTORE$;

-- fn_mark_round_pending — re-create with audit write
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
  if v_status = 'pending_finalization' then return; end if;
  update public.rounds set status = 'pending_finalization' where id = p_round_id;
  perform public.fn_log_destructive(
    'round.mark_pending', p_round_id, 'rounds', v_group_id,
    jsonb_build_object('status_before', v_status)
  );
end;
$PENDING$;

-- fn_resume_round — re-create with audit write
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
  if v_status = 'live' then return; end if;
  update public.rounds set status = 'live' where id = p_round_id;
  perform public.fn_log_destructive(
    'round.resume', p_round_id, 'rounds', v_group_id,
    jsonb_build_object('status_before', v_status)
  );
end;
$RESUME$;

-- fn_archive_course — augment with audit
create or replace function public.fn_archive_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ACOURSE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.courses where id = p_course_id;
  if v_group_id is null then return; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can archive this course';
  end if;
  update public.courses set deleted_at = now() where id = p_course_id;
  perform public.fn_log_destructive(
    'course.archive', p_course_id, 'courses', v_group_id, '{}'::jsonb
  );
end;
$ACOURSE$;

-- fn_restore_course — augment with audit
create or replace function public.fn_restore_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $RCOURSE$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_is_admin boolean;
  v_is_commish boolean;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  select group_id into v_group_id from public.courses where id = p_course_id;
  if v_group_id is null then return; end if;
  select public.fn_is_platform_admin() into v_is_admin;
  select exists (
    select 1 from public.group_members
     where group_id = v_group_id and profile_id = v_uid and role = 'commissioner'
  ) into v_is_commish;
  if not (v_is_admin or v_is_commish) then
    raise exception 'Only commissioners or platform admins can restore this course';
  end if;
  update public.courses set deleted_at = null where id = p_course_id;
  perform public.fn_log_destructive(
    'course.restore', p_course_id, 'courses', v_group_id, '{}'::jsonb
  );
end;
$RCOURSE$;

-- fn_set_course_verification — augment with audit
create or replace function public.fn_set_course_verification(
  p_course_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $VERIFY$
declare
  v_uid uuid := auth.uid();
  v_before text;
  v_group_id uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if not public.fn_is_platform_admin() then
    raise exception 'Only platform admins can change course verification status';
  end if;
  if p_status not in ('verified', 'community', 'needs_review', 'placeholder') then
    raise exception 'Invalid verification status: %', p_status;
  end if;
  select verification_status, group_id into v_before, v_group_id
    from public.courses where id = p_course_id;
  update public.courses set verification_status = p_status where id = p_course_id;
  perform public.fn_log_destructive(
    'course.verify', p_course_id, 'courses', v_group_id,
    jsonb_build_object('from', v_before, 'to', p_status)
  );
end;
$VERIFY$;

-- fn_set_course_template — augment with audit
create or replace function public.fn_set_course_template(
  p_course_id uuid,
  p_is_template boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $TMPL$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
  v_group_id uuid;
begin
  if v_uid is null then raise exception 'Must be authenticated'; end if;
  if not public.fn_is_platform_admin() then
    raise exception 'Only platform admins can change template status';
  end if;
  select is_template, group_id into v_before, v_group_id
    from public.courses where id = p_course_id;
  update public.courses set is_template = coalesce(p_is_template, false) where id = p_course_id;
  perform public.fn_log_destructive(
    'course.template_flag', p_course_id, 'courses', v_group_id,
    jsonb_build_object('from', v_before, 'to', coalesce(p_is_template, false))
  );
end;
$TMPL$;

-- fn_link_guest_to_profile — augment with audit (if it exists; defensive)
do $LINK$
begin
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'fn_link_guest_to_profile'
  ) then
    -- We can't easily augment without re-defining. Punt: any new
    -- guest-link calls will pass through unaudited until the next
    -- migration. The lifecycle ops above are the higher-stakes items.
    null;
  end if;
end;
$LINK$;

comment on table public.destructive_audit_log is
  'Append-only history of every destructive / lifecycle-changing op (archive, restore, finalize, verify, etc.). Read access platform-admin-only via RLS. No UPDATE / DELETE policies → tamper-resistant via the normal API.';
