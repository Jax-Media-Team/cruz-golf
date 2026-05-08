# Golf Games

A modern, mobile-first golf scoring + betting app for recurring golf groups. Tracks rounds, calculates course/playing handicaps under the World Handicap System, runs live leaderboards, and settles a wide library of betting games.

## Why this exists

Golf Genius is overkill (and pricey) for a regular foursome or a club mens' day. This is a tighter tool for one commissioner running rounds across a known group of friends or club members.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Supabase (Postgres, Auth, Realtime, Storage)
- Deployed to Vercel
- Optional OCR via OpenAI Vision (`gpt-4o`) or any vision endpoint with the same shape

## Quick start

```bash
# 1. Install
cd golf-games-app
npm install

# 2. Configure Supabase
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# fill SUPABASE_SERVICE_ROLE_KEY (server only)

# 3. Apply database schema
# In your Supabase project SQL editor, run the files in supabase/migrations/ in order.

# 4. Dev
npm run dev
```

Tests:

```bash
npm test           # run vitest once
npm run test:watch # watch mode
```

## Documentation

All planning artifacts live in [`docs/`](./docs/):

- [PRD](docs/PRD.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [User flows](docs/USER_FLOWS.md)
- [Screen-by-screen UI plan](docs/UI_PLAN.md)
- [Handicap calculation logic](docs/HANDICAP_LOGIC.md)
- [Betting / game calculation logic](docs/BETTING_LOGIC.md)
- [API & integrations plan](docs/INTEGRATIONS.md)
- [MVP build plan](docs/MVP_PLAN.md)
- [Roadmap](docs/ROADMAP.md)

## Project structure

```
golf-games-app/
  app/                      Next.js App Router routes
    (app)/                  authenticated app shell
      dashboard/
      players/
      courses/
      rounds/[id]/score/
      rounds/[id]/leaderboard/
    api/scorecard-ocr/      OCR upload endpoint
  components/ui/            primitives (Button, Card, Input, etc.)
  lib/
    handicap.ts             WHS course/playing handicap math
    scoring.ts              gross -> net, stroke allocation
    games/                  one file per game format
    supabase/               browser + server clients
    types.ts                shared TypeScript types
  supabase/migrations/      ordered SQL migrations
  tests/                    vitest unit tests
  docs/                     planning + reference
```

## Important: GHIN access

There is no public GHIN API. The USGA's Golfer Product Access (GPA) program is the only sanctioned path and is restricted to approved vendors. Until/unless you join GPA, this app uses **manual Handicap Index entry** with optional refresh prompts, plus admin override on every round. See [INTEGRATIONS.md](docs/INTEGRATIONS.md) for the full plan and the legal alternatives.
