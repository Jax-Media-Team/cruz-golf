-- 0042 — Enable realtime publication on the junk tables.
--
-- 0041 created round_junk_config + round_junk_items but didn't add
-- them to the supabase_realtime publication. The JunkControls
-- component subscribes via `postgres_changes` filtered by round_id
-- — for that subscription to deliver INSERT/UPDATE/DELETE events,
-- the table must be in the publication.
--
-- round_presses (migration 0035) appears to have been added to the
-- publication via the Supabase dashboard (it's not in any
-- migration), which works but isn't reproducible. This file fixes
-- that pattern for junk by adding the publication step explicitly +
-- idempotently. Safe to re-run.
--
-- If Supabase is set to "all tables" auto-publish, the guard below
-- makes this a no-op. If it's per-table publish, this file is the
-- difference between live junk sync and "the other player has to
-- refresh to see your birdie."

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_junk_items'
  ) then
    alter publication supabase_realtime add table public.round_junk_items;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_junk_config'
  ) then
    alter publication supabase_realtime add table public.round_junk_config;
  end if;
end$$;
