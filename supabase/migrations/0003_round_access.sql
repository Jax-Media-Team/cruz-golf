-- Round-level access control: every round has a 4-digit PIN.
-- Players "join" a round once with the PIN; their profile is added to round_invitees.
-- Score writes require the writer to be in round_invitees OR the round's commissioner.

alter table public.rounds add column if not exists pin text;
alter table public.rounds add column if not exists access_mode text not null default 'invited'
  check (access_mode in ('invited','open_to_group'));

-- Generate PINs for any existing rounds that don't have one.
update public.rounds
   set pin = lpad((floor(random()*10000))::int::text, 4, '0')
 where pin is null;

alter table public.rounds alter column pin set not null;

-- Default for new rounds: random 4-digit PIN.
alter table public.rounds alter column pin
  set default lpad((floor(random()*10000))::int::text, 4, '0');

-- Track who is allowed to score on a given round.
create table if not exists public.round_invitees (
  round_id uuid not null references public.rounds(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (round_id, profile_id)
);

alter table public.round_invitees enable row level security;

-- A user can read their own invitee rows, and any commissioner of the group can read all.
create policy "round_invitees self read" on public.round_invitees for select
  using (
    profile_id = auth.uid()
    or round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

-- A user can insert their own invitee row only by going through the join_round RPC
-- (which validates the PIN). Direct inserts are denied except for commissioners.
create policy "round_invitees commissioner insert" on public.round_invitees for insert
  with check (
    round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

create policy "round_invitees commissioner delete" on public.round_invitees for delete
  using (
    round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

-- The PIN-validating join RPC. Runs as definer so it can write past RLS,
-- but only if the supplied PIN matches.
create or replace function public.fn_join_round(p_round_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_round from public.rounds where id = p_round_id;
  if not found then
    raise exception 'Round not found';
  end if;
  if v_round.pin <> p_pin then
    return false;
  end if;
  insert into public.round_invitees (round_id, profile_id)
       values (p_round_id, auth.uid())
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.fn_join_round(uuid, text) from public;
grant execute on function public.fn_join_round(uuid, text) to authenticated;

-- Tighten the scores RLS to require an invitee row OR commissioner role.
-- Keep an "open_to_group" escape hatch for rounds the commissioner explicitly
-- marks as open.
drop policy if exists "scores via round_player" on public.scores;

create policy "scores readable in group" on public.scores for select
  using (
    round_player_id in (
      select rp.id from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where r.group_id in (select fn_my_group_ids())
    )
  );

create policy "scores writable for invitees" on public.scores for insert
  with check (
    round_player_id in (
      select rp.id
        from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where r.group_id in (select fn_my_group_ids())
         and (
           r.access_mode = 'open_to_group'
           or exists (
             select 1 from public.round_invitees ri
              where ri.round_id = r.id and ri.profile_id = auth.uid()
           )
           or exists (
             select 1 from public.group_members gm
              where gm.group_id = r.group_id
                and gm.profile_id = auth.uid()
                and gm.role = 'commissioner'
           )
         )
    )
  );

create policy "scores updatable for invitees" on public.scores for update
  using (
    round_player_id in (
      select rp.id
        from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where r.group_id in (select fn_my_group_ids())
         and (
           r.access_mode = 'open_to_group'
           or exists (
             select 1 from public.round_invitees ri
              where ri.round_id = r.id and ri.profile_id = auth.uid()
           )
           or exists (
             select 1 from public.group_members gm
              where gm.group_id = r.group_id
                and gm.profile_id = auth.uid()
                and gm.role = 'commissioner'
           )
         )
    )
  );

create policy "scores deletable for commissioner" on public.scores for delete
  using (
    round_player_id in (
      select rp.id
        from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where exists (
         select 1 from public.group_members gm
          where gm.group_id = r.group_id
            and gm.profile_id = auth.uid()
            and gm.role = 'commissioner'
       )
    )
  );
