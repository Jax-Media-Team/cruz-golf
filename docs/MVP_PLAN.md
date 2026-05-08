# MVP build plan

## Definition of MVP

A commissioner can:
1. Sign up, create a group.
2. Enter players (manual HI), enter a course (manual rating/slope/par + hole SI/par), create a round.
3. Configure at least these games on a round: individual_net, skins_net, nassau, best_ball_net.
4. Players (or the commissioner) enter scores hole-by-hole on a phone.
5. Live leaderboard (gross, net, skins, bets) updates in real time.
6. Commissioner finalizes; "who pays whom" screen prints.

## Phase plan

### Phase 0 — Project skeleton (1-2 hr)
- Next.js + TS + Tailwind scaffold.
- Supabase client wired up.
- App shell, login/signup, dashboard with empty state.
- Vercel deployment guide in README.

### Phase 1 — Pure logic + tests (1 day)
- `lib/handicap.ts` — courseHandicap, playingHandicap, strokesPerHole, netForHole, applyCap.
- `lib/scoring.ts` — leaderboard projection (gross/net standings from a round snapshot).
- `lib/games/*` — individual_gross, individual_net, best_ball, aggregate, skins, canadian_skins, nassau, match_play.
- Vitest unit tests for every game asserting the zero-sum invariant on representative inputs.

### Phase 2 — Database (½ day)
- `0001_init.sql` migration: all tables, indexes, RLS policies.
- `0002_seed.sql`: a sample group, two courses, six players, one finalized round (for screenshots and tests).

### Phase 3 — Player & course CRUD (1 day)
- `/players` list + drawer editor.
- `/courses` list + tee + hole grid editor.
- Server actions for create/update/soft-delete.

### Phase 4 — Round setup + score entry (1-2 days)
- `/rounds/new` 3-step wizard.
- `/rounds/[id]` with Leaderboard / Skins / Bets / Card tabs.
- `/rounds/[id]/score` mobile entry.
- Realtime subscription wired.
- Score-events audit on every write.

### Phase 5 — Settlements + spectator (½ day)
- Finalize action: run all games, write `settlements`, lock scores.
- "Who pays whom" greedy minimization rendered as a list.
- Spectator route + token-keyed projection.

### Phase 6 — Scorecard photo upload (½ day, optional for MVP)
- `/api/scorecard-ocr` endpoint (OpenAI Vision adapter).
- Upload → review grid → confirm → batch save.

## Out of MVP

- Push notifications.
- Offline score entry queue.
- PDF export.
- Multi-tenant billing.
- True 9-hole rating support beyond the half-of-18 fallback.
- Social profile features.
- Stableford scoring (modular, ships post-MVP).

## Acceptance tests

- Run a full round end-to-end with 6 players × 18 holes × 3 games. Settlement matches a hand calculation.
- Edit a 14th-hole score after entry; leaderboard, skins, and projected payouts all update within 1 second.
- Finalize, then re-finalize after a corrected score; settlement rows are replaced, not appended.
- Spectator URL works from a private window (no auth).
