# Database Schema

Postgres on Supabase. All money in cents (`BIGINT`). All IDs `uuid`. Soft-delete via `deleted_at` only on `players` and `courses`; everything else is hard-deleted (no audit complications).

## Tables

### `profiles`
The Supabase Auth user, augmented.
| col | type | notes |
|---|---|---|
| id | uuid PK | references `auth.users.id` |
| display_name | text | |
| role | text | `'commissioner' \| 'player'` per workspace; group-level role is on `group_members` |
| created_at | timestamptz default now() | |

### `groups`
A recurring group of golfers (e.g. "Saturday Crew"). Multi-tenancy boundary.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | |
| owner_id | uuid not null | references `profiles.id` |
| created_at | timestamptz default now() | |

### `group_members`
| col | type | notes |
|---|---|---|
| group_id | uuid | FK groups |
| profile_id | uuid | FK profiles, nullable for non-account guests linked later |
| player_id | uuid | FK players |
| role | text | `'commissioner' \| 'player' \| 'spectator'` |
| PK | (group_id, player_id) | |

### `players`
The directory of golfers a group plays with. Decoupled from auth so guests can exist without accounts.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid | FK groups |
| profile_id | uuid | nullable; links to a real account when known |
| display_name | text not null | |
| email | text | |
| phone | text | |
| ghin_number | text | optional, indexed |
| handicap_index | numeric(4,1) | nullable; e.g. 14.2 |
| handicap_index_source | text | `'manual' \| 'ghin' \| 'admin' \| 'self'` |
| handicap_updated_at | timestamptz | |
| default_tee_id | uuid | FK course_tees, nullable |
| is_guest | bool default false | |
| deleted_at | timestamptz | |

### `courses`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid | FK groups |
| name | text | |
| city | text | |
| state | text | |
| usga_course_id | text | optional, ncrdb id for re-lookup |
| created_at | timestamptz default now() | |
| deleted_at | timestamptz | |

### `course_tees`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| course_id | uuid | FK courses |
| name | text | e.g. "Blue", "White", "Forward" |
| gender | text | `'M' \| 'F' \| 'any'` |
| holes | int | 9 or 18 |
| rating | numeric(4,1) | course rating, e.g. 71.2 |
| slope | int | 55..155, e.g. 132 |
| par | int | total par |

### `course_holes`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| tee_id | uuid | FK course_tees |
| hole_number | int | 1..18 |
| par | int | |
| stroke_index | int | 1..18, allocation rank |
| yardage | int | nullable |
| UNIQUE (tee_id, hole_number) | | |

### `rounds`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid | FK groups |
| course_id | uuid | FK courses |
| date | date | |
| holes | int | 9 or 18 |
| starting_hole | int | 1 or 10 |
| status | text | `'draft' \| 'live' \| 'finalized'` |
| created_by | uuid | FK profiles |
| created_at | timestamptz default now() | |
| finalized_at | timestamptz | |
| spectator_token | text | random url-safe token for read-only link |
| settings | jsonb | per-round defaults, see below |

`rounds.settings` shape:
```json
{
  "scoring_max": "double_bogey_plus" | "triple_bogey" | "none",
  "score_entry_mode": "self_only" | "any_player",
  "lock_after_finalize": true
}
```

### `round_players`
A player participating in a round, with the tee they're playing and their effective handicap for THIS round.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid | FK rounds |
| player_id | uuid | FK players |
| tee_id | uuid | FK course_tees |
| handicap_index_used | numeric(4,1) | snapshot of HI used |
| course_handicap | int | computed at round start, can be overridden |
| playing_handicap | int | course_handicap × allowance |
| handicap_overridden | bool default false | |
| team_id | uuid | FK round_teams, nullable |
| display_order | int | for stable UI ordering |
| UNIQUE (round_id, player_id) | | |

### `round_teams`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid | FK rounds |
| name | text | e.g. "A&B", "Reds" |

### `round_games`
A single game configured on a round. A round can have many games.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid | FK rounds |
| game_type | text | enum below |
| name | text | display label override |
| stake_cents | bigint | |
| allowance_pct | int | e.g. 100, 95, 85 — applied to course handicap |
| config | jsonb | game-specific params |

`game_type` enum:
`individual_gross | individual_net | best_ball_gross | best_ball_net | aggregate_gross | aggregate_net | skins_gross | skins_net | skins_canadian | nassau | match_play | ctp | long_drive | custom`

`config` shapes per game type are documented in [BETTING_LOGIC.md](BETTING_LOGIC.md).

### `scores`
Authoritative current score per player per hole.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_player_id | uuid | FK round_players |
| hole_number | int | |
| gross | int | nullable until entered |
| putts | int | nullable, optional |
| penalties | int | nullable, optional |
| locked | bool default false | |
| updated_at | timestamptz default now() | |
| updated_by | uuid | FK profiles |
| UNIQUE (round_player_id, hole_number) | | |

### `score_events`
Append-only audit of every score write.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| score_id | uuid | FK scores |
| round_player_id | uuid | denormalized for query |
| hole_number | int | denormalized |
| old_gross | int | nullable |
| new_gross | int | nullable |
| reason | text | optional commissioner note |
| changed_by | uuid | FK profiles |
| changed_at | timestamptz default now() | |

### `manual_entries`
For closest-to-pin, long drive, and custom side-bet inputs.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_game_id | uuid | FK round_games |
| hole_number | int | nullable for whole-round bets |
| winner_round_player_id | uuid | FK round_players, nullable for "no winner" |
| value_cents | bigint | for custom side bets where the stake varies |
| note | text | |

### `scorecard_uploads`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid | FK rounds |
| uploaded_by | uuid | FK profiles |
| storage_path | text | path in supabase storage bucket |
| ocr_result | jsonb | parsed score map keyed by player+hole |
| applied | bool default false | |
| created_at | timestamptz default now() | |

### `settlements`
Snapshot of who owes whom, written on finalize. Supports manual override.
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid | FK rounds |
| from_round_player_id | uuid | FK round_players |
| to_round_player_id | uuid | FK round_players |
| amount_cents | bigint | always positive |
| breakdown | jsonb | which games/lines this rolls up |

## Row-level security

Standard pattern: users can read/write rows whose `group_id` is in `group_members where profile_id = auth.uid()`. Commissioners get write on rounds/games/scores; players get write on their own `scores` rows. Spectator links use a public RPC keyed by `rounds.spectator_token` that returns a read-only projection.

## Indexes

- `players (group_id, deleted_at)` for the directory query.
- `players (ghin_number)` for the GHIN lookup.
- `scores (round_player_id, hole_number)` for the leaderboard scan.
- `score_events (round_player_id, changed_at desc)` for audit.
- `rounds (group_id, status, date desc)` for the dashboard list.
- `round_players (round_id, display_order)` for stable rendering.

## Migrations

Located at `supabase/migrations/`:
- `0001_init.sql` — all tables, indexes, RLS policies.
- `0002_seed.sql` — example courses/players/group for local dev only (skip in prod).
