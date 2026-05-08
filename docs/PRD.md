# Product Requirements Document

## Vision

A clean, mobile-first golf app for recurring private groups. One commissioner sets up rounds; players self-score on their phones; a live leaderboard updates instantly; betting games settle automatically against custom group rules.

## Target user

- Commissioner: organizes weekly/recurring games, knows the group, runs the bets.
- Players: regular foursome or larger group; want fast score entry and a clear leaderboard.
- Spectator (optional): a guest with a read-only link who wants to watch the leaderboard.

## Non-goals

- Replacing GHIN as a handicap provider.
- Tournament management at the scale of a 144-player club championship.
- Public discoverability or a social network.
- Hardware integrations (rangefinders, GPS).

## Core jobs to be done

1. As a commissioner I can set up a round in under 2 minutes for a known group at a known course.
2. As a player I can enter my hole-by-hole gross scores on my phone in seconds.
3. As anyone in the round I can see live gross, net, skins, team, and bet standings without refreshing.
4. As a commissioner I can correct a score, with an audit trail, without breaking the leaderboard.
5. As a commissioner I can finalize the round and see exactly who owes whom what.

## Functional requirements

### Player management
- CRUD: name, email/phone, GHIN number (optional), default tee, default group, current Handicap Index.
- Distinguish full members from one-off guests.
- Handicap Index can be: refreshed (if GPA-approved), pulled by manual lookup, self-entered, or admin-overridden.
- Per-round override on Handicap Index that does not modify the player profile.

### Course setup
- CRUD: course name, location, set of tees (color/name, gender, rating, slope, par, yardages, hole handicaps).
- Required per tee: course rating, slope, par. Hole-by-hole par + handicap (1-18) recommended.
- Support 9-hole sub-rounds (front 9 / back 9) using only those 9 holes' ratings if the course publishes a 9-hole rating, otherwise fall back to half of 18-hole values.
- Different players can play different tees in the same round.

### Round setup
- Pick course + date + tees per player + format(s).
- Pick players from the directory; add ad-hoc guests inline.
- Pick teams for team formats (drag-to-pair UI).
- Configure each game: stake, allowance %, carry/no-carry, ties handling, etc.
- Allow multiple games on the same round (e.g., individual net + skins + Nassau).

### Game formats (must support at MVP)
- Individual gross
- Individual net
- 2-man best ball gross / net
- Team aggregate gross / net
- Gross skins
- Net skins
- Canadian skins (configurable: birdie validation, half-skin on push, value escalation)
- Nassau (front/back/overall, optional press rules)
- Match play (front/back/overall)
- Closest to the pin (manual entry per par-3)
- Long drive (manual entry per chosen hole)
- Custom side bets (free-form name + stake + winner picker)

### Live scoring
- Hole-by-hole gross entry.
- Auto-derive net per stroke allocation.
- Live leaderboard pushes via Supabase Realtime.
- Tabs/cards: Gross, Net, Skins, Teams, Bets.
- Score lock per player and per round; commissioner override.
- Edit history: every score change recorded with old/new value, who changed it, when.

### Scorecard photo upload
- Player or commissioner uploads a phone photo of a paper card.
- Server-side OCR returns hole-by-hole gross.
- User confirms in a review screen before save; nothing finalizes silently.
- Photo retained as evidence on the round.

### Betting engine
- Per-game stake config; whole-round buy-in optional.
- Skins: skin value, ties (push/carry/split), birdie-validation, escalation schedules.
- Nassau: front/back/overall stakes, presses (auto vs manual, threshold).
- Best ball / aggregate: per-side stake, gross or net.
- Side bets: closest-to-pin pots, long drive, KP, sandies, etc.
- Live "projected payout" view that updates with every score.
- Final settlement screen: who pays whom, net per player.

### Roles & permissions
- Commissioner: full read/write on the round, override, lock/unlock, finalize.
- Player: read all, write own scores only (toggleable to allow any-player entry), view audit on their own scores.
- Spectator: read-only via signed link, no auth required.

### Audit & accuracy
- Every score change creates a row in `score_events`.
- Round finalization is a discrete state; after finalize, edits require commissioner action and re-finalize.
- Currency math uses cents (BIGINT) end to end. Never floats.

## Non-functional requirements

- **Mobile first**: every flow tested on a phone-sized viewport. Tap targets ≥ 44px. Score entry reachable with one thumb.
- **Offline-tolerant score entry**: optimistic local writes, queued sync when reconnected. (V2 — MVP can require connection.)
- **Realtime**: leaderboard reflects new scores within 1s under normal conditions.
- **Privacy**: player data is per-account. No cross-tenant leakage. RLS on every table.
- **Compliance**: no scraping or unsanctioned use of GHIN or USGA data. See INTEGRATIONS.md.

## Success criteria

- Commissioner can set up + run + settle a real Saturday round end-to-end on a phone.
- Net scores, skins, and team math match a hand calculation on every supported format.
- No floating-point drift in money settlement.
