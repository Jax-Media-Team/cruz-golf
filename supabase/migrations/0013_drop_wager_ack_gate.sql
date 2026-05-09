-- Remove the wager-ack RLS gate.
--
-- Per product decision, the wager handshake is friction more than value.
-- The /wagers page still exists for groups that explicitly want to use it,
-- but it no longer blocks score writes.
--
-- New policies: invitees (or any group member when access_mode='open_to_group')
-- can write scores without needing an ack row, regardless of stakes.

drop policy if exists "scores writable for invitees" on public.scores;
create policy "scores writable for invitees" on public.scores for insert
  with check (
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
           or
           r.access_mode = 'open_to_group'
           or exists (
             select 1 from public.round_invitees ri
              where ri.round_id = r.id and ri.profile_id = auth.uid()
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
           or
           r.access_mode = 'open_to_group'
           or exists (
             select 1 from public.round_invitees ri
              where ri.round_id = r.id and ri.profile_id = auth.uid()
           )
         )
    )
  );
