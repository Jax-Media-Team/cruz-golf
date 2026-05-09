-- Defensive: add WITH CHECK to the scores UPDATE policy mirroring USING.
-- Without it, a user could in theory update a row's round_player_id to
-- another rp they can also see — moving scores between players. Limited
-- blast radius (still bound by group membership) but no good reason to
-- allow it.

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
  )
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
