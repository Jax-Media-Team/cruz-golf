# Historical event continuity — model + roadmap

**Status:** model defined, no implementation yet (per Patrick, 2026-05-11).
**Owner:** product
**Last revised:** 2026-05-11

This doc defines what "historical event continuity" means inside Cruz
Golf and what we'd build to support it. **Do not implement** without
Patrick's go-ahead — the surface area is large and the right phasing
depends on which examples turn into real club traditions first.

---

## What Patrick asked for

> "The event/trip/member-guest has memory over time, similar to the
> group history concept. Examples: annual event winners, prior year
> champions, all-time event money leaders, trip history, event records,
> Ryder Cup-style cumulative standings, 'last year's winner,' etc. Do
> not build a huge system yet, but define the model and roadmap."

The product north star is "the operating system for private golf
groups." Group-level history is already a strong moat — lifetime
totals, rivalry runs, partner records. Event-level history is the
**next layer** above that: a Member-Guest that runs every year
should feel like *the same event*, not three separate ones in three
separate years.

---

## Concrete examples this enables

The proof of the concept is the **header card** a player would see
when they pull up THIS YEAR'S event:

> **Sunday Crew Member-Guest · 2026**
> Year 4 of 4 · Last year: Cruz + Lewis (12 up over the field)
> Series record: Howard + Smith — 2 wins (2023, 2025)

Other surfaces that fall out of the same data model:

- **"Last year's winner"** banner on the event landing page
- **Series leaderboard** — cumulative standings across all editions
- **Event records** — lowest gross, biggest money take, longest streak
- **Trip history** — "the Pinehurst trip" as a series with each year's
  roster + champion
- **Ryder Cup-style cumulative** — across multiple meetings of the
  same two crews, a running tally
- **Member-Guest anniversaries** — "10th time playing this event"

---

## Data model proposal (additive — no migration to a new shape)

We already have `events` (Phase 1+2+3 shipped — see `MULTI_GROUP_DESIGN.md`).
The proposed addition is a thin `event_series` concept:

```sql
-- New table: event_series
create table if not exists event_series (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,                  -- "Member-Guest", "Pinehurst Trip"
  kind text not null,                  -- enum: tournament | trip | club_game
  -- Series records that aggregate across editions. Pure-function
  -- builder computes them; this is just denormalized for fast read.
  -- All optional — the series can exist with no editions yet.
  first_year integer,
  most_recent_year integer,
  -- Visual / metadata
  description text,
  logo_url text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Additive column on existing events table:
alter table events add column if not exists series_id uuid
  references event_series(id);
```

**Key design rules — don't violate:**

1. **`series_id` is OPTIONAL on `events`.** Existing events stay
   first-class. A series is *added later* by setting `series_id` on
   one or more existing events. We never break "single event" UX.

2. **Series is group-scoped.** Same as everything else in Cruz Golf
   — no cross-group history. The Member-Guest at Club A doesn't
   show up to Club B.

3. **Series state is pure-function-derived from event finalizations.**
   We do NOT have a separate `series_results` table. Re-rendering a
   series leaderboard is `buildSeries(events_in_series).` Pattern
   matches the existing engine architecture (clubhouse signals,
   event standings).

4. **Series doesn't gate event lifecycle.** Whether an event is in a
   series has zero effect on `draft → live → pending → finalized`.

---

## Engine — pure-function builders

Following the established pattern (clubhouse, events, presses), the
series engine is pure-function over a finalized snapshot.

```ts
// lib/event-series/engine.ts (proposed)
export type SeriesEdition = {
  event_id: UUID;
  year: number;
  name: string;
  status: "draft" | "live" | "pending_finalization" | "finalized";
  // From buildEventBundle — only present when finalized:
  champion_player_id: UUID | null;
  champion_team_player_ids: UUID[] | null;
  winning_score: number | null;
  total_money_cents: number;
  field_size: number;
};

export type SeriesRecord = {
  player_id: UUID;
  display_name: string;
  wins: number;
  podiums: number;     // top 3 finishes
  appearances: number;
  lifetime_money_cents: number;
  best_finish: number;
  best_finish_year: number | null;
  best_gross: number | null;
  best_net: number | null;
  win_years: number[];   // [2023, 2025]
};

export type SeriesBundle = {
  series: EventSeries;
  editions: SeriesEdition[];  // sorted by year desc
  records: SeriesRecord[];    // sorted by wins desc, podiums desc, name asc
  // Surfaced on the "this year" event card:
  last_year_summary: {
    year: number;
    champion_label: string;   // "Cruz + Lewis"
    margin_label: string;     // "12 up over the field"
  } | null;
};

export function buildSeriesBundle(
  series: EventSeries,
  finalizedBundles: EventBundle[]
): SeriesBundle;
```

Same Vitest convention: regression tests for the builder, no React
in the engine, thin presentational components consume the bundle.

---

## Surfaces — UI / routes

| Surface | Route | Renders |
|---|---|---|
| Series landing page | `/series/[id]` | Hero with champion-of-record + lifetime money leader; editions list; series records leaderboard |
| Event page header card | `/events/[id]` | "Last year: …" line + "Year X of Y" badge when event has `series_id` |
| Series picker on event create | `/events/new` | Optional "Part of a series?" dropdown — pick existing series or create new |
| Dashboard "Annual events" strip | `/dashboard` | Card per active series the user belongs to, "next edition: TBD / scheduled" |
| Group page series block | `/groups/[id]` | Series owned by the group, with most-recent year |

**Pattern**: the series page is read-only at v1. Commissioners can
edit series metadata (name, description, logo) but the records and
champion data are auto-derived.

---

## Phasing — proposed cuts (each is a shippable milestone)

### Phase 1 — Schema + read path (1 migration, 1 engine file, 1 page)

- Migration `00XX_event_series.sql` (table + `series_id` column +
  helper indexes).
- `lib/event-series/engine.ts` with `buildSeriesBundle`.
- `/series/[id]` page — read-only, shows editions list + records.
- Series records: wins, appearances, lifetime money, best gross/net.
- Tests: 8-12 cases covering empty series, 1 edition, multi-year
  champion tracking, partner-team championship (Member-Guest format).

**Out of scope at this phase**: no editing UI, no creation flow.
Series rows are inserted by hand via SQL or Supabase Studio to
validate the data shape with real club data first.

### Phase 2 — Commissioner creation + assignment

- `/events/new` adds an optional "Series" picker.
- `/series/new` flow for creating a fresh series.
- Reassign event ↔ series via admin tooling (no destructive ops —
  just sets/clears `series_id` with audit log entry).
- Series settings page: name, description, logo.

### Phase 3 — Surfaces on existing pages

- Event header card shows "Last year: …" when `event.series_id` set.
- Dashboard "Annual events" strip — surfaces upcoming editions
  based on the group's series.
- Group page lists series.

### Phase 4 — Series-specific records

- "Course mastery within the series" — for a series that always
  plays the same course (the Member-Guest at JGCC), surface the
  course-specific records as series records too.
- Series streaks — "Howard has played 4 editions in a row · won 2."
- Series rivalries — "Cruz + Lewis are 2-1 vs Howard + Smith over
  3 editions."

### Phase 5 — Cross-event cumulative (Ryder Cup–style)

- A SECOND kind of series — "match series" where two fixed teams
  meet over multiple events and a running tally tracks who's ahead.
- Different data model than annual-event series; defer until a
  real client wants it.

---

## Open questions / things to validate before building

1. **Year semantics**: is "the 2026 Member-Guest" derived from
   `event.start_date.year`? What if an event spans Dec 31 → Jan 1?
   Probably store an explicit `series_year` on `events`.

2. **Champion attribution for team events**: a Member-Guest "winning
   team" is a 2-player team (member + guest). Do we attribute the
   win to both players? (Probably yes — `champion_team_player_ids`
   in `SeriesEdition`.)

3. **Series money totals**: include or exclude side games / presses?
   For a tournament series the headline is base-game money. For a
   trip series it might be all-in. Make it configurable per series
   (`include_side_game_money: boolean`).

4. **Re-jiggering an existing event into a series after the fact**:
   if Patrick finalizes 3 Member-Guests this year, then decides
   they're a series next year, can he retroactively `series_id`
   them? Yes — schema supports it. Confirm UI gives a clean
   "Group events into a series" multi-select.

5. **Guests in series records**: a Member-Guest brings non-member
   players in. Should they appear on the series records leaderboard
   permanently? Suggested rule: yes if they have a Cruz Golf
   account (Q5 in CLAUDE.md "Open strategic questions"); skip
   otherwise.

6. **Series privacy**: same as everything else — group-private by
   default. Public spectator tokens for individual events still work
   but no public series leaderboard URL until friends-list ships.

---

## What this is NOT

- **Not a cross-group league.** Same group-privacy rules as
  everything else.
- **Not a tournament-management replacement.** No bracketed
  match-play series, no qualification rounds. We surface what
  happened; we don't run it.
- **Not auto-derived.** A series isn't computed from "events with
  similar names" — Patrick (or the commissioner) explicitly creates
  it and assigns events.
- **Not a public social feed.** No "your friend won the
  Member-Guest" notification across groups.

---

## Risks / things that will go wrong

- **Naming drift.** Year 1 of the Member-Guest might be called
  "Spring Member-Guest", Year 2 "Member-Guest 2025", Year 3
  "MG-2026". The series-level name fixes the display; events keep
  their own names.

- **Duplicate champions when teams change**: if Cruz wins with
  Lewis one year and with Howard the next, both players show up in
  series records under "wins" with annotation of the partner.

- **Soft-deleted editions**: a finalized event that gets
  `deleted_at` set should NOT count toward series records. The
  pure-function builder filters on `deleted_at IS NULL`.

- **The "year" field semantics are subtle.** Don't infer from
  dates; store explicitly.

---

## Decision required from Patrick before Phase 1

1. ✅ Confirm the `event_series` table + `series_id` column shape.
2. ✅ Confirm series is group-scoped (matches privacy model).
3. ⏳ Pick the first real series to seed — Jacksonville Sunday Crew
   Member-Guest history? Pinehurst trip across years?
4. ⏳ Decide on the year-attribution rule (explicit field vs.
   derived from `start_date`).

When Patrick says go, drop the schema and ship Phase 1.
