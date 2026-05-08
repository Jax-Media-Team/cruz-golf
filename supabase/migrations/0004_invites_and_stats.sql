-- Single-use, anti-forwarding invites + helper indexes for stats.

create table if not exists public.round_invites (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  intended_for_name text not null,
  intended_email text,                 -- if set, redemption requires the auth'd email to match
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id),
  expires_at timestamptz                -- nullable, defaults to no expiry
);
create index if not exists round_invites_round_idx on public.round_invites (round_id);
create index if not exists round_invites_token_idx on public.round_invites (token);

alter table public.round_invites enable row level security;

-- Commissioners of the round's group can manage invites.
create policy "round_invites commissioner read" on public.round_invites for select
  using (
    round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
    or redeemed_by = auth.uid()
  );

create policy "round_invites commissioner write" on public.round_invites for all
  using (
    round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  )
  with check (
    round_id in (
      select id from public.rounds where group_id in (
        select group_id from public.group_members
         where profile_id = auth.uid() and role = 'commissioner'
      )
    )
  );

-- RPC: redeem an invite. Validates token, optional email match, single-use.
-- Adds the redeeming user to round_invitees; returns the round_id on success.
create or replace function public.fn_redeem_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.round_invites%rowtype;
  v_email text;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_invite from public.round_invites where token = p_token;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.redeemed_at is not null then
    raise exception 'Invite already used';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite expired';
  end if;
  if v_invite.intended_email is not null
     and lower(v_invite.intended_email) <> lower(coalesce(v_email,'')) then
    raise exception 'Invite is for a different email address';
  end if;

  update public.round_invites
     set redeemed_at = now(), redeemed_by = v_uid
   where id = v_invite.id;

  insert into public.round_invitees (round_id, profile_id)
       values (v_invite.round_id, v_uid)
  on conflict do nothing;

  return v_invite.round_id;
end;
$$;
revoke all on function public.fn_redeem_invite(text) from public;
grant execute on function public.fn_redeem_invite(text) to authenticated;

-- Helpful indexes for the stats queries.
create index if not exists scores_join_round_idx on public.scores (round_player_id);
create index if not exists round_players_round_idx on public.round_players (round_id);
