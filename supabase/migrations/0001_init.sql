-- Golf Games — initial schema
-- Run inside Supabase SQL editor (uses extensions auth, pgcrypto).

create extension if not exists pgcrypto;

-- profiles ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- groups --------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  player_id uuid not null,
  role text not null check (role in ('commissioner','player','spectator')),
  primary key (group_id, player_id)
);

-- players -------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  email text,
  phone text,
  ghin_number text,
  handicap_index numeric(4,1),
  handicap_index_source text check (handicap_index_source in ('manual','ghin','admin','self')),
  handicap_updated_at timestamptz,
  default_tee_id uuid,
  is_guest boolean not null default false,
  deleted_at timestamptz
);
create index if not exists players_group_idx on public.players (group_id) where deleted_at is null;
create index if not exists players_ghin_idx on public.players (ghin_number);

-- courses -------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  city text,
  state text,
  usga_course_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.course_tees (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  gender text not null default 'any' check (gender in ('M','F','any')),
  holes int not null check (holes in (9,18)),
  rating numeric(4,1) not null,
  slope int not null check (slope between 55 and 155),
  par int not null
);

create table if not exists public.course_holes (
  id uuid primary key default gen_random_uuid(),
  tee_id uuid not null references public.course_tees(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  par int not null,
  stroke_index int not null check (stroke_index between 1 and 18),
  yardage int,
  unique (tee_id, hole_number)
);

-- rounds --------------------------------------------------------------------
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  date date not null,
  holes int not null default 18 check (holes in (9,18)),
  starting_hole int not null default 1,
  status text not null default 'draft' check (status in ('draft','live','finalized')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  spectator_token text unique not null default encode(gen_random_bytes(16), 'hex'),
  settings jsonb not null default jsonb_build_object('scoring_max','none','score_entry_mode','any_player','lock_after_finalize',true)
);
create index if not exists rounds_group_idx on public.rounds (group_id, status, date desc);

create table if not exists public.round_teams (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  name text not null
);

create table if not exists public.round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id),
  tee_id uuid not null references public.course_tees(id),
  handicap_index_used numeric(4,1),
  course_handicap int not null default 0,
  playing_handicap int not null default 0,
  handicap_overridden boolean not null default false,
  team_id uuid references public.round_teams(id) on delete set null,
  display_order int not null default 0,
  unique (round_id, player_id)
);
create index if not exists round_players_idx on public.round_players (round_id, display_order);

create table if not exists public.round_games (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  game_type text not null,
  name text not null,
  stake_cents bigint not null default 0,
  allowance_pct int not null default 100,
  config jsonb not null default '{}'::jsonb
);

-- scoring -------------------------------------------------------------------
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  round_player_id uuid not null references public.round_players(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  gross int,
  putts int,
  penalties int,
  locked boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique (round_player_id, hole_number)
);
create index if not exists scores_rp_hole_idx on public.scores (round_player_id, hole_number);

create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  score_id uuid references public.scores(id) on delete set null,
  round_player_id uuid not null,
  hole_number int not null,
  old_gross int,
  new_gross int,
  reason text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists score_events_rp_idx on public.score_events (round_player_id, changed_at desc);

create table if not exists public.manual_entries (
  id uuid primary key default gen_random_uuid(),
  round_game_id uuid not null references public.round_games(id) on delete cascade,
  hole_number int,
  winner_round_player_id uuid references public.round_players(id) on delete set null,
  value_cents bigint,
  note text
);

create table if not exists public.scorecard_uploads (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  uploaded_by uuid references public.profiles(id),
  storage_path text not null,
  ocr_result jsonb,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  from_round_player_id uuid not null references public.round_players(id),
  to_round_player_id uuid not null references public.round_players(id),
  amount_cents bigint not null check (amount_cents > 0),
  breakdown jsonb not null default '[]'::jsonb
);

-- score audit trigger -------------------------------------------------------
create or replace function public.fn_score_audit() returns trigger
language plpgsql as $$
begin
  insert into public.score_events (
    score_id, round_player_id, hole_number, old_gross, new_gross, changed_by
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.round_player_id, old.round_player_id),
    coalesce(new.hole_number, old.hole_number),
    case when (tg_op = 'UPDATE' or tg_op = 'DELETE') then old.gross end,
    case when (tg_op = 'UPDATE' or tg_op = 'INSERT') then new.gross end,
    coalesce(new.updated_by, old.updated_by)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_score_audit on public.scores;
create trigger trg_score_audit
after insert or update or delete on public.scores
for each row execute function public.fn_score_audit();

-- RLS -----------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.players enable row level security;
alter table public.courses enable row level security;
alter table public.course_tees enable row level security;
alter table public.course_holes enable row level security;
alter table public.rounds enable row level security;
alter table public.round_teams enable row level security;
alter table public.round_players enable row level security;
alter table public.round_games enable row level security;
alter table public.scores enable row level security;
alter table public.score_events enable row level security;
alter table public.manual_entries enable row level security;
alter table public.scorecard_uploads enable row level security;
alter table public.settlements enable row level security;

-- helper fn: current user's group_ids
create or replace function public.fn_my_group_ids() returns setof uuid
language sql security definer set search_path = public as $$
  select gm.group_id
  from public.group_members gm
  where gm.profile_id = auth.uid();
$$;

-- profiles: each user reads/updates their own
create policy "profiles self read" on public.profiles for select using (id = auth.uid());
create policy "profiles self upsert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles self update" on public.profiles for update using (id = auth.uid());

-- groups: members read; owners write
create policy "groups members read" on public.groups for select
  using (id in (select fn_my_group_ids()));
create policy "groups owner write" on public.groups for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- group_members: members read their own group memberships
create policy "group_members read" on public.group_members for select
  using (group_id in (select fn_my_group_ids()) or profile_id = auth.uid());

-- generic "in my group" pattern
create policy "players in my group" on public.players for all
  using (group_id in (select fn_my_group_ids()))
  with check (group_id in (select fn_my_group_ids()));

create policy "courses in my group" on public.courses for all
  using (group_id in (select fn_my_group_ids()))
  with check (group_id in (select fn_my_group_ids()));

create policy "tees via course" on public.course_tees for all
  using (course_id in (select id from public.courses where group_id in (select fn_my_group_ids())))
  with check (course_id in (select id from public.courses where group_id in (select fn_my_group_ids())));

create policy "holes via tee" on public.course_holes for all
  using (tee_id in (select id from public.course_tees where course_id in (select id from public.courses where group_id in (select fn_my_group_ids()))))
  with check (tee_id in (select id from public.course_tees where course_id in (select id from public.courses where group_id in (select fn_my_group_ids()))));

create policy "rounds in my group" on public.rounds for all
  using (group_id in (select fn_my_group_ids()))
  with check (group_id in (select fn_my_group_ids()));

create policy "round_teams via round" on public.round_teams for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

create policy "round_players via round" on public.round_players for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

create policy "round_games via round" on public.round_games for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

create policy "scores via round_player" on public.scores for all
  using (round_player_id in (select id from public.round_players where round_id in (select id from public.rounds where group_id in (select fn_my_group_ids()))))
  with check (round_player_id in (select id from public.round_players where round_id in (select id from public.rounds where group_id in (select fn_my_group_ids()))));

create policy "score_events via round_player" on public.score_events for select
  using (round_player_id in (select id from public.round_players where round_id in (select id from public.rounds where group_id in (select fn_my_group_ids()))));

create policy "manual_entries via game" on public.manual_entries for all
  using (round_game_id in (select id from public.round_games where round_id in (select id from public.rounds where group_id in (select fn_my_group_ids()))))
  with check (round_game_id in (select id from public.round_games where round_id in (select id from public.rounds where group_id in (select fn_my_group_ids()))));

create policy "uploads via round" on public.scorecard_uploads for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

create policy "settlements via round" on public.settlements for all
  using (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())))
  with check (round_id in (select id from public.rounds where group_id in (select fn_my_group_ids())));

-- realtime --
alter publication supabase_realtime add table public.scores;
alter publication supabase_realtime add table public.manual_entries;
alter publication supabase_realtime add table public.round_games;
alter publication supabase_realtime add table public.rounds;
