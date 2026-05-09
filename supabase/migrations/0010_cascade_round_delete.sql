-- Round delete was failing with "violates foreign key constraint" because
-- settlements.from_round_player_id and to_round_player_id had no
-- ON DELETE CASCADE. When a round is deleted, cascades try to remove
-- round_players AND settlements simultaneously; depending on order Postgres
-- can hit a FK check on round_players that fails because settlements still
-- references it.
--
-- Fix: switch the settlement FKs to ON DELETE CASCADE. Settlements are
-- tied to a single round; if the round goes away, the settlement record
-- has no meaning anyway.

alter table public.settlements
  drop constraint if exists settlements_from_round_player_id_fkey;
alter table public.settlements
  add constraint settlements_from_round_player_id_fkey
  foreign key (from_round_player_id)
  references public.round_players(id)
  on delete cascade;

alter table public.settlements
  drop constraint if exists settlements_to_round_player_id_fkey;
alter table public.settlements
  add constraint settlements_to_round_player_id_fkey
  foreign key (to_round_player_id)
  references public.round_players(id)
  on delete cascade;
