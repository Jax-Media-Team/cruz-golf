-- Player profiles: Venmo handle + avatar URL.
-- Avatar is auto-populated from Google OAuth metadata when available; commissioners can override.

alter table public.profiles add column if not exists avatar_url text;

alter table public.players add column if not exists venmo_handle text;
alter table public.players add column if not exists avatar_url text;
alter table public.players add column if not exists notes text;

-- Index for venmo lookups (rare, but cheap).
create index if not exists players_venmo_idx on public.players (venmo_handle) where venmo_handle is not null;
