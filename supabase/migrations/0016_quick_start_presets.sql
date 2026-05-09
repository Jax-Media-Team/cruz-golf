-- Per-user "save my favorite game setup" feature.
--
-- The /rounds/new page already has a Quick Start row of preset packages
-- (GAME_PACKAGES.ts) — those are platform-curated. This adds USER-saved
-- presets so commissioners can save "my Saturday combo" once and load it
-- into every future round in one tap.

create table if not exists public.quick_start_presets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) > 0 and length(name) <= 80),
  emoji text,
  blurb text,
  /** Array of { game_type, stake_cents, allowance_pct, config } objects */
  games jsonb not null default '[]'::jsonb,
  is_favorite boolean not null default false,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists quick_start_presets_profile_idx
  on public.quick_start_presets (profile_id, last_used_at desc nulls last);

alter table public.quick_start_presets enable row level security;

drop policy if exists "presets self read" on public.quick_start_presets;
create policy "presets self read" on public.quick_start_presets for select
  using (profile_id = auth.uid());

drop policy if exists "presets self write" on public.quick_start_presets;
create policy "presets self write" on public.quick_start_presets for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
