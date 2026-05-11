# Multi-group / large-game design

**Status:** Design proposal, not yet built. Awaiting Patrick's review of the
shape before any schema or code lands.

**Trigger:** Member-guest tournaments, golf trips, and club games are the
biggest real-world use case the app doesn't natively support yet. 16
players in 4 foursomes playing the same course + games is a common
member-member format; today the app treats it as 4 disconnected rounds
with no shared leaderboard, no cross-foursome game settlement, and
duplicated commissioner work.

This doc thinks through what to add, what to **deliberately not** add,
and how the existing concepts (round, game, press, settlement, audit)
extend cleanly.

---

## What needs to work

### Scenario A — Member-Guest tournament

- 16 players, 4 foursomes, one day
- Same course, same tees per flight
- Three games running across the **entire field**:
  - Net stroke play (lowest team net wins flight)
  - Skins gross across all 16
  - Closest-to-pin / Long drive (manual outcome entries)
- Each foursome has its own scorer (one phone per group)
- Live leaderboard visible to spectators across all 4 foursomes
- Final settlement aggregates field-wide

### Scenario B — Golf trip

- 8 players, 3 days, 3 different courses, 2 foursomes per day
- Recurring foursomes (or mixed lineups per day)
- Trip-wide running totals: who's up across all 6 rounds played
- Each round can have its own games (e.g. day 1 scramble, day 2 Nassau)
- Per-foursome AND trip-wide commissioner role

### Scenario C — Club Saturday morning

- 12 players, 3 foursomes, every Saturday
- Same group, low ceremony
- Foursome-level games (each foursome plays its own Nassau)
- One overall "low net of the day" prize that crosses foursomes

These three share enough structure that one abstraction handles them all,
but they differ in:
- How many days
- How many courses
- Whether games are field-wide vs foursome-only
- Whether foursomes are fixed across days

---

## Proposed model

### New concept: **Event**

An **Event** is a top-level container that groups one or more **Rounds**.

| Event | Rounds inside | Days | Courses | Games |
|---|---|---|---|---|
| Member-guest tournament | 4 (one per foursome) | 1 | 1 | Field-wide + per-foursome |
| Golf trip | 6 (two foursomes × three days) | 3 | 3 | Per-round, with optional trip-wide rolling totals |
| Saturday club game | 3 (one per foursome) | 1 | 1 | Per-foursome + one cross-foursome prize |

Why "Event" instead of "Tournament":
- Tournament implies bracket/elimination — wrong shape for trips and casual Saturday games
- "Event" is the term real golf groups use ("the member-guest event", "the trip")
- Generic enough for the trip case (multi-day)

### Schema sketch (additive, non-destructive)

```sql
create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  name text not null,
  -- "tournament" | "trip" | "club_game" — UI hint only; engine treats them all the same
  kind text not null default 'tournament',
  starts_on date not null,
  ends_on date,
  spectator_token uuid default gen_random_uuid(), -- one public link for the whole event
  commissioner_profile_id uuid references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz default now()
);

-- Each round optionally belongs to an event. Existing rounds (no event)
-- stay first-class — events are an opt-in layer.
alter table public.rounds
  add column event_id uuid references public.events(id) on delete set null;

-- Event-level games. These run across EVERY round in the event.
-- Per-round games stay in round_games as today.
create table public.event_games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  game_type public.game_type not null,
  name text not null,
  stake_cents int not null default 0,
  allowance_pct int default 100,
  config jsonb default '{}'
);

-- Optional flighting (handicap-based grouping). Defer until needed —
-- the engine works without flighting for v1.
-- create table public.event_flights ( ... );
```

Two key invariants:
1. A round can exist **without** an event (current behavior preserved).
2. Event-level games settle across **every round in the event**;
   per-round games settle within their round only.

### Settlement model

Event-level games settle by treating every round_player in the event as
a single field. Concretely:

- **Net stroke play across the field**: take each player's net total from
  their round, rank them, the lowest N split a pot.
- **Skins across the field**: per-hole min net across the entire field,
  with skins resolving as today but the eligible pool is everyone.
- **CTP / Long Drive**: manual entries (existing `settleManualGame`)
  already work — just scope them to an event_id instead of round_id.

The existing `settleGame` engine doesn't change. Event-level settlement
is a new pure function that takes:
- All rounds in the event
- All round_players in those rounds (and their player_id, so cross-round
  identity is preserved)
- All scores
- The event_games config

It returns the same `GameOutput` shape — per-player cents delta — so
the existing `minimumFlow` and audit hooks handle it identically.

### Live sync — how the leaderboard stays current across 4 phones

This is where the design gets interesting.

Today each round has its own Supabase Realtime channel
(`round-${roundId}-scores`). For multi-group:

- **Per-foursome scoring**: each round keeps its own channel, exactly
  as today. Scorers don't change behavior.
- **Event-level spectator view**: subscribes to **all** the round IDs
  in the event. Cheap — Supabase Realtime allows multiple
  subscriptions per client. On any score change in any foursome, the
  event leaderboard refetches.
- **Cross-group commissioner view**: same as spectator + can act on
  any round.

No new RPC machinery needed for sync — just multi-subscribe in the
client component.

### Press handling in a multi-group event

Three real-world questions:

1. **Can a press cross foursomes?** No — keep it foursome-scoped.
   A press only makes sense between players in the same group physically
   walking the same holes. The existing `round_presses` table doesn't
   change.

2. **Do event-level games support auto-press?** Defer. Auto-press
   matches Nassau / Best Ball within a foursome; cross-foursome auto-
   press has no real analogue. Add only if a real group asks.

3. **Manual press accept across foursomes?** Same answer — no.
   Presses stay round-scoped, which is round_id-keyed.

### Commissioner flow

One **event commissioner** (set on creation). They can:
- Create the event with games + roster
- Assign players to foursomes (creates the underlying rounds)
- See live status of every foursome
- Finalize the event when all foursomes are done
- Resolve disputes via the existing audit log (now also tagged with
  event_id where relevant)

Each foursome's round still has its own scorer (typically the lowest-
handicap player or a designated scorekeeper). They focus only on their
foursome — the event commissioner handles cross-foursome coordination.

### Spectator flow

The event gets its own `spectator_token` UUID. Sharing the URL
`/events/[id]/leaderboard?token=...` shows:

- Field-wide leaderboard (current standings across all foursomes)
- Per-foursome status: live thru-hole, current leader, last activity
- Event-level games projected payouts (live as scores come in)
- Per-foursome games can be toggled visible/hidden

Same token mechanism the round spectator uses. No new auth surface.

### Pace-of-play awareness

For tournaments specifically, the event view should surface
**pace-of-play** signals at a glance. Per-foursome:

- Holes completed
- Current pace (faster / slower than expected)
- Last score-write timestamp ("Foursome B last entered hole 7 · 8 min ago")

This is just an aggregation of existing data — no new schema needed.
Surfaces on the event commissioner's view + the spectator view.

### Conflicting score entry

Real-world risk: two phones in the same foursome both try to score the
same player. Today this is handled by upsert (newest write wins per
`(round_player_id, hole_number)`). Multi-group doesn't change this —
scoring is still round-scoped, and the upsert behavior is unchanged.

The "who scored what" attribution lives in `scores.updated_by`
(profile_id of the writer). The audit log captures lifecycle ops but
not individual score writes; if disputes about "who entered the wrong
score" become real, we can add a per-write audit trail later.

### Synchronization / reconnect

Same as today: each round's realtime channel auto-reconnects via the
Supabase SDK; the 60s safety-net refresh fires on every subscribe. The
event leaderboard subscribes to N round channels at once and refetches
on any of them.

Score-queue offline behavior is per-device and round-scoped — already
solid. No change.

---

## What I deliberately do NOT propose

- **No global tournament leaderboard outside a group.** Per the privacy
  model (CLAUDE.md): no cross-group surfaces. An event belongs to a
  group; only group members + spectator-link holders see it.
- **No bracket / elimination format.** Real golf groups don't use it.
- **No live commentary / chat per foursome.** Out of scope; group chats
  on iMessage / WhatsApp handle this better than we ever would.
- **No flighting in v1.** Easy to add later when a real event needs it.
- **No auto-foursome-assignment.** Commissioner picks foursomes
  manually. Algorithmic pairing (random, balanced-by-handicap, etc.) is
  a polish-later feature.
- **No payment splits beyond the existing settlement engine.** The
  minimum-flow + Venmo deep-link path already works; events just feed
  more data into the same pipe.

---

## Migration & rollout plan

Phased so we can ship a usable v1 quickly without committing to the
full design.

### Phase 1 — Schema + read-only event view

- Migration: add `events` table, `event_games` table, `event_id` column
  on rounds
- No UI yet — the schema is in place but not surfaced
- Existing rounds untouched

### Phase 2 — Event commissioner flow

- `/events/new` page — create an event, pick a course, set games
- "Add foursome" — creates a round with `event_id` pre-set
- Event home page `/events/[id]` — list of foursomes + their status
- Commissioner can finalize all foursomes from one place

### Phase 3 — Event-level leaderboard + settlement

- Pure-function event settlement engine (`lib/events/settle.ts`)
- Field-wide leaderboard + projected payouts on the event home + on
  the spectator surface
- Audit log entries tagged with `event_id`

### Phase 4 — Polish

- Pace-of-play indicators per foursome
- Quick "add me to foursome X" join flow for late additions
- Pre-event reminders ("event starts in 1 day") — opt-in only

### What to skip until a real group asks

- Flighting
- Tournament brackets
- Multi-event seasonal championships
- Cross-group invitations

---

## Open questions for Patrick

1. **Event commissioner — same as round commissioner or separate role?**
   Recommended: separate role on the `events` table. The round
   commissioner is automatic (creator); the event commissioner is set
   on event creation and can be different from any of the foursome
   scorers.

2. **What happens if an event commissioner is also playing?** They
   still play. Their phone is just the most-likely scoring device for
   their foursome AND the event coordination device.

3. **Settlement payment splits — same minimum-flow algorithm or new?**
   Recommended: same. The minimum-flow path already handles N players;
   it doesn't care if N=4 or N=16.

4. **Pace-of-play notifications — push or just visible?** Recommended:
   just visible in the event view for now. Push needs a notifications
   infrastructure we don't have yet (Q6 in CLAUDE.md).

5. **9-hole events?** Yes. The engine doesn't care about 9 vs 18 —
   already handled per-round.

---

## Test plan (when ready to build)

- Pure-function event-settlement engine: unit tests for each event
  game type (skins-across-field, net-stroke-play, CTP)
- Event-end-to-end simulation: 16-player event with 4 foursomes, mixed
  games, full settlement asserts zero-sum
- Live-sync simulation: mock realtime updates from 4 foursomes,
  verify event leaderboard updates within 1 socket round-trip
- Press isolation: confirm a manual press in foursome A doesn't leak
  into foursome B's settlement
- Spectator surface: unauthenticated access via token; admin-mode
  banner re-verifies admin status

---

## What this is NOT

This proposal is **not** a sweeping redesign of the round concept.
Rounds keep working exactly as today. Events are an optional layer on
top — a way to GROUP rounds, share games across them, and present a
unified leaderboard. Without an event, the round behaves identically
to today's code.

The smallest possible v1 is:
- `events` table
- `event_id` nullable column on `rounds`
- An event home page that lists its rounds + a shared leaderboard
- No event-level games yet — just the aggregation view

That alone solves the "where do I send 16 spectators?" problem for a
member-guest. Everything else is incremental.
