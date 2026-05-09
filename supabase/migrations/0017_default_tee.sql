-- Per-player default-tee preference.
--
-- Each golfer typically plays the same tee at every course (their style:
-- "I'm a White-tee guy"). Instead of forcing them to pick the right tee
-- every round, store the preferred TEE NAME (Black/Blue/White/Gold/Red)
-- on the player. /rounds/new matches the course's tees by name.

alter table public.players
  add column if not exists default_tee_name text;

-- No index needed — it's only read at round-creation time.
