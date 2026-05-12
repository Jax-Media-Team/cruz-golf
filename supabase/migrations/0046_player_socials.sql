-- 0046 — player social profile fields
--
-- Per Patrick 2026-05-12: "Should users be able to set up their profile
-- with a venmo link, social media page, etc.?" Yes — venmo_handle already
-- exists on players (0006), this adds the rest of the personal-expression
-- fields a member of a private golf group might want to surface.
--
-- All four are optional, free-form text. They appear on /players/[id]/stats
-- below the Venmo block and feed any future "share to Instagram / X" CTAs.
-- They do NOT change discovery semantics — Cruz Golf stays group-private
-- by default (see CLAUDE.md privacy model). These are display-only fields.
--
-- Idempotent: each ADD COLUMN is guarded with IF NOT EXISTS. Re-running
-- this migration on a database where the columns already exist is a
-- no-op.

alter table public.players
  add column if not exists ig_handle text,
  add column if not exists x_handle text,
  add column if not exists website_url text,
  add column if not exists bio_line text;

-- Trim whitespace on insert / update for the handles. Defensive vs UI
-- accidentally writing " patrick " — we want lookups + display to be
-- canonical without forcing the client to remember to trim.
--
-- NB: bio_line is left as-is (a user might intentionally include
-- leading spacing or formatting); the others are tight handles / URLs
-- where leading/trailing whitespace is always a mistake.
create or replace function public.tf_players_trim_socials()
returns trigger
language plpgsql
as $$
begin
  if new.ig_handle is not null then
    new.ig_handle := nullif(btrim(new.ig_handle, ' @'), '');
  end if;
  if new.x_handle is not null then
    new.x_handle := nullif(btrim(new.x_handle, ' @'), '');
  end if;
  if new.website_url is not null then
    new.website_url := nullif(btrim(new.website_url), '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_players_trim_socials on public.players;
create trigger trg_players_trim_socials
  before insert or update of ig_handle, x_handle, website_url
  on public.players
  for each row
  execute function public.tf_players_trim_socials();

-- Force PostgREST to pick up the new columns immediately so the
-- profile editor doesn't get "Could not find the 'ig_handle' column"
-- the first time it tries to write. Same pattern used in 0043.
notify pgrst, 'reload schema';
