-- Wager acknowledgements: every invited player has to confirm the stakes
-- before they can write scores on a round.

create table if not exists public.round_wager_acks (
  round_id uuid not null references public.rounds(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (round_id, profile_id)
);

alter table public.round_wager_acks enable row level security;

-- A user can read/write their own ack rows. Commissioners of the group can read all.
create policy "wager_acks self read" on public.round_wager_acks for select
  using (
    profile_id = auth.uid()
    or round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

create policy "wager_acks self write" on public.round_wager_acks for insert
  with check (profile_id = auth.uid());

create policy "wager_acks self delete" on public.round_wager_acks for delete
  using (
    profile_id = auth.uid()
    or round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

-- Tighten scores write policies further: must have an ack row when there are
-- any games with stakes on this round. Commissioners can still write to fix
-- mistakes regardless.
drop policy if exists "scores writable for invitees" on public.scores;
create policy "scores writable for invitees" on public.scores for insert
  with check (
    round_player_id in (
      select rp.id
        from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where r.group_id in (select fn_my_group_ids())
         and (
           -- Commissioner override
           exists (
             select 1 from public.group_members gm
              where gm.group_id = r.group_id
                and gm.profile_id = auth.uid()
                and gm.role = 'commissioner'
           )
           or (
             -- Invitee status (PIN or invite-token) AND wager ack if needed
             (
               r.access_mode = 'open_to_group'
               or exists (
                 select 1 from public.round_invitees ri
                  where ri.round_id = r.id and ri.profile_id = auth.uid()
               )
             )
             and (
               -- Either no money games, or the user has acked
               not exists (
                 select 1 from public.round_games rg
                  where rg.round_id = r.id and rg.stake_cents > 0
               )
               or exists (
                 select 1 from public.round_wager_acks wa
                  where wa.round_id = r.id and wa.profile_id = auth.uid()
               )
             )
           )
         )
    )
  );

drop policy if exists "scores updatable for invitees" on public.scores;
create policy "scores updatable for invitees" on public.scores for update
  using (
    round_player_id in (
      select rp.id
        from public.round_players rp
        join public.rounds r on r.id = rp.round_id
       where r.group_id in (select fn_my_group_ids())
         and (
           exists (
             select 1 from public.group_members gm
              where gm.group_id = r.group_id
                and gm.profile_id = auth.uid()
                and gm.role = 'commissioner'
           )
           or (
             (
               r.access_mode = 'open_to_group'
               or exists (
                 select 1 from public.round_invitees ri
                  where ri.round_id = r.id and ri.profile_id = auth.uid()
               )
             )
             and (
               not exists (
                 select 1 from public.round_games rg
                  where rg.round_id = r.id and rg.stake_cents > 0
               )
               or exists (
                 select 1 from public.round_wager_acks wa
                  where wa.round_id = r.id and wa.profile_id = auth.uid()
               )
             )
           )
         )
    )
  );
