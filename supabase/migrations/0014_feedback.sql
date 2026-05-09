-- Feedback / feature requests / bug reports / scoring issues / general
-- inbound from users straight into the platform admin queue.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text,
  kind text not null check (kind in ('feature','game','bug','scoring','course','other')),
  body text not null check (length(body) > 0 and length(body) <= 5000),
  /** Round / group / round_player context if available. */
  round_id uuid references public.rounds(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  user_agent text,
  app_version text,
  status text not null default 'new' check (status in ('new','reviewing','planned','in_progress','shipped','declined')),
  admin_notes text,
  resolved_at timestamptz
);

create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
create index if not exists feedback_profile_idx on public.feedback (profile_id, created_at desc);

alter table public.feedback enable row level security;

-- Anyone authenticated can submit feedback for themselves.
drop policy if exists "feedback insert by self" on public.feedback;
create policy "feedback insert by self" on public.feedback for insert
  with check (profile_id is null or profile_id = auth.uid());

-- Users see their own; platform admins see everything.
drop policy if exists "feedback read self or admin" on public.feedback;
create policy "feedback read self or admin" on public.feedback for select
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.platform_admins where profile_id = auth.uid())
  );

-- Only platform admins update/delete (status changes, admin notes).
drop policy if exists "feedback admin update" on public.feedback;
create policy "feedback admin update" on public.feedback for update
  using (exists (select 1 from public.platform_admins where profile_id = auth.uid()))
  with check (exists (select 1 from public.platform_admins where profile_id = auth.uid()));

drop policy if exists "feedback admin delete" on public.feedback;
create policy "feedback admin delete" on public.feedback for delete
  using (exists (select 1 from public.platform_admins where profile_id = auth.uid()));
