-- The score-audit trigger fires AFTER each insert/update/delete on scores
-- and writes a row into public.score_events. score_events has RLS enabled
-- but only has a SELECT policy — meaning every score INSERT was being
-- rolled back when the trigger tried to insert the audit row and RLS
-- denied it ("new row violates row-level security policy for table
-- score_events").
--
-- Fix: make the trigger function SECURITY DEFINER so the audit insert
-- bypasses RLS. Audit logs are a system concern; they should always
-- succeed regardless of which user wrote the score. Also add a defensive
-- INSERT policy so direct (non-trigger) writes work for group members.

create or replace function public.fn_score_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $AUDIT$
begin
  insert into public.score_events (
    score_id, round_player_id, hole_number, old_gross, new_gross, changed_by
  ) values (
    coalesce(new.id, old.id),
    coalesce(new.round_player_id, old.round_player_id),
    coalesce(new.hole_number, old.hole_number),
    case when (tg_op = 'UPDATE' or tg_op = 'DELETE') then old.gross else null end,
    case when (tg_op = 'INSERT' or tg_op = 'UPDATE') then new.gross else null end,
    coalesce(new.updated_by, old.updated_by, auth.uid())
  );
  return null;
end;
$AUDIT$;

-- Defensive: also add an INSERT policy that mirrors the SELECT policy, so
-- direct inserts (not via trigger) by group members continue to succeed
-- if any code path ever tries one.
drop policy if exists "score_events insert via round_player" on public.score_events;
create policy "score_events insert via round_player" on public.score_events for insert
  with check (
    round_player_id in (
      select id from public.round_players
       where round_id in (
         select id from public.rounds where group_id in (select fn_my_group_ids())
       )
    )
  );
