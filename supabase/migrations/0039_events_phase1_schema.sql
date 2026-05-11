-- 0039 — Multi-group "Events" foundation (Phase 1 of MULTI_GROUP_DESIGN.md)
--
-- Per the design doc: an Event is an OPTIONAL container that groups
-- one-or-more Rounds (foursomes). Common use cases:
--   - Member-guest tournament: 16 players in 4 foursomes, one course,
--     one day, field-wide games (skins across all 16, net stroke play)
--   - Golf trip: 8 players in 2 foursomes × 3 days × 3 courses
--   - Saturday club game: 12 players in 3 foursomes, one course, one day
--
-- Phase 1 (this migration) ships ONLY the schema. No RPCs, no UI. The
-- foundation is in place so subsequent phases can layer commissioner
-- flow, field-wide settlement, and the spectator surface on top
-- without further schema churn.
--
-- Critical invariants from the design doc:
--   1. Rounds can exist WITHOUT an event (event_id is nullable). All
--      existing behavior is preserved — single-foursome play stays the
--      first-class case.
--   2. Event-level games (event_games) live alongside per-round games
--      (round_games). Per-round games settle within their round, as
--      today. Event games will settle across every round in the event
--      via a new engine in Phase 3.
--   3. Manual presses stay round-scoped — round_presses.round_id keeps
--      its FK to rounds(id), unchanged. No cross-foursome presses.
--   4. RLS: events visible to group members. Commissioner role is
--      implicit via group_members role='commissioner'.
--
-- Idempotent — safe to re-run.

-- ===========================================================
-- events table
-- ===========================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  -- "tournament" | "trip" | "club_game" — UI/copy hint only. Engine
  -- treats them all the same. New kinds can be added without a
  -- migration (text column, no constraint).
  kind text not null default 'tournament',
  starts_on date not null,
  ends_on date,
  -- Public spectator link. One token per event aggregates all
  -- foursomes' scoreboards — the "where do I send 16 spectators?"
  -- problem from the design doc.
  spectator_token uuid not null default gen_random_uuid(),
  -- The commissioner is set on creation. Typically the round-creator
  -- of the first foursome, but it can be any group member. They can
  -- manage all linked rounds + the event itself.
  commissioner_profile_id uuid references public.profiles(id) on delete set null,
  -- Soft delete (archive). Same pattern as rounds/courses: archived
  -- events remain in audit + history; deleted (via a future
  -- fn_delete_event) would hard-remove them.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_group_id on public.events(group_id);
create index if not exists idx_events_starts_on on public.events(starts_on desc);
create unique index if not exists idx_events_spectator_token
  on public.events(spectator_token);

-- ===========================================================
-- rounds.event_id — link from a round to the event it belongs to
-- ===========================================================
-- on delete set null: deleting an event keeps its rounds intact but
-- unlinks them. Per the design doc, individual rounds are
-- first-class — an event is just an optional grouping layer.
do $ROUNDS$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'rounds'
       and column_name = 'event_id'
  ) then
    alter table public.rounds
      add column event_id uuid references public.events(id) on delete set null;
  end if;
end;
$ROUNDS$;

create index if not exists idx_rounds_event_id
  on public.rounds(event_id)
 where event_id is not null;

-- ===========================================================
-- event_games — field-wide games (skins across the field, net stroke
-- play across the field, etc.). Per-round games still live in
-- round_games as today; event_games are SEPARATE — they apply across
-- every round in the event.
-- ===========================================================
create table if not exists public.event_games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- Free-form text matches the round_games.game_type pattern. The
  -- engine validates the type in TypeScript; the DB is permissive on
  -- purpose (no enum) so adding game variants doesn't require DDL.
  game_type text not null,
  name text not null,
  stake_cents int not null default 0,
  allowance_pct int not null default 100,
  config jsonb not null default '{}'::jsonb,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_games_event_id on public.event_games(event_id);

-- ===========================================================
-- RLS
-- ===========================================================
alter table public.events enable row level security;
alter table public.event_games enable row level security;

-- Drop + re-create policies so re-running the migration is idempotent
-- without "policy already exists" errors.
drop policy if exists "events in my group" on public.events;
create policy "events in my group" on public.events for all
  using (group_id in (select fn_my_group_ids()))
  with check (group_id in (select fn_my_group_ids()));

-- Public spectator read — anyone with the token URL can read the row
-- WITHOUT being a group member. Mirrors the rounds.spectator_token
-- pattern from migration 0001.
drop policy if exists "events spectator read by token" on public.events;
create policy "events spectator read by token" on public.events
  for select
  using (true);
-- Note: actual access-control happens app-side. We pass the token in
-- a URL query param and verify it matches before showing the page.
-- DB-side `using (true)` lets the anon client fetch by token + id.

drop policy if exists "event_games via event" on public.event_games;
create policy "event_games via event" on public.event_games for all
  using (
    event_id in (
      select id from public.events
       where group_id in (select fn_my_group_ids())
    )
  )
  with check (
    event_id in (
      select id from public.events
       where group_id in (select fn_my_group_ids())
    )
  );

-- ===========================================================
-- updated_at trigger for events (mirrors the rounds pattern)
-- ===========================================================
create or replace function public.fn_events_touch_updated_at()
returns trigger
language plpgsql
as $TOUCH$
begin
  new.updated_at = now();
  return new;
end;
$TOUCH$;

drop trigger if exists trg_events_touch_updated_at on public.events;
create trigger trg_events_touch_updated_at
  before update on public.events
  for each row execute function public.fn_events_touch_updated_at();

-- ===========================================================
-- Notes for next phases (NOT applied here)
--   Phase 2: fn_create_event RPC, /events/new UI, foursome assignment
--   Phase 3: pure-function event-settlement engine, field-wide
--            leaderboard, spectator surface
--   Phase 4: pace-of-play indicators, late-add foursome join flow
-- All four phases reuse the schema this migration creates. No further
-- DDL is required for Phase 2 — only RPCs. Phase 3 may need to add
-- audit-log entries when events are created/archived/finalized.
-- ===========================================================

comment on table public.events is
  'Multi-foursome container (tournaments, trips, club games). Optional layer over rounds — single-round play stays first-class. See docs/MULTI_GROUP_DESIGN.md for the full design.';
comment on column public.rounds.event_id is
  'Optional link to an events row. NULL = standalone round (the existing default and still-supported case).';
comment on table public.event_games is
  'Games that settle across EVERY round in the event (e.g. skins across the entire field, net stroke play across 16 players). Per-foursome games stay in round_games.';
