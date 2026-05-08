# Cruz Golf — Project Overview

A summary of what's built so far. Pasteable into ChatGPT for review/feedback.

---

## What it is (in one paragraph)

Cruz Golf is a mobile-first web app for **private recurring golf groups** — foursomes, men's days, member games. The commissioner sets up a round; players join via PIN/invite from their phone; everyone scores hole-by-hole on their own device; a live leaderboard updates in real time; bets (Skins, Nassau, Best Ball, 6-6-6, etc.) settle automatically; final tally pre-fills Venmo for the people who owe money. Designed to replace ad-hoc spreadsheets, paper scorecards, and Golf Genius for groups that don't need tournament-grade software.

**Domain owner:** "Cruz" (Patrick Cruz, Jacksonville FL). The app is being built around his Saturday foursome at Jacksonville Golf & Country Club.

---

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** with a custom palette (deep emerald `brand-*`, warm cream `cream-*`, brand gold `gold-*`)
- **Instrument Serif** (display) + **Inter** (body) via `next/font/google`
- **Supabase** — Postgres + Auth + Realtime + Storage. Row-level security on every table.
- **next/og** for shareable OG-image PNGs (1200×630 leaderboard cards with settlement chips)
- **qrcode** for Venmo deep-link QRs on player profiles
- **vitest** for pure-logic unit tests (29 currently, all green)
- Deployed on **Vercel** (recommended)

---

## What's been built

### 1. Brand & visual identity
- **Logo** — user-provided icon (crossed gold irons + golf ball with "C" inside) at `public/cruz-logo.png`. Transparent, no wordmark. Treated as a static brand asset, never redrawn in SVG.
- **`<Logo>` and `<BrandLockup>` components** — height-driven (width auto-scales from natural aspect), defaults to icon-only.
- **Color system** — Augusta-leaning emerald (`brand-900` deep green, `brand-950` near-black), warm cream surfaces (`cream-50/100`), and **brand gold** (`gold-400/500/600`) for accents. Red `text-red-400` for under-par.
- **Typography** — Instrument Serif for display headlines, score numbers, and the leaderboard. Inter for body. Tracked uppercase eyebrows (`text-[10px] uppercase tracking-[0.32em]`).
- **PWA manifest** — installable on iOS/Android home screen with the logo as the app icon.

### 2. Auth & access control
- Email/password signup + login via Supabase Auth.
- **Google OAuth** with auto-profile-creation and avatar pulled from Google metadata. Falls back gracefully if not configured.
- App shell at `app/(app)/layout.tsx` redirects unauthenticated users to `/login`. Public landing + demo + spectator leaderboard remain accessible without login.

### 3. Per-round access (PIN + single-use invites)
- Every round has a **4-digit PIN** generated automatically (`rounds.pin`).
- Two `access_mode` values: `invited` (default — must redeem PIN or invite) and `open_to_group`.
- `round_invitees` table tracks who's been admitted to a round. Only invitees + group commissioners can write scores (enforced by RLS).
- `round_invites` table holds **single-use, anti-forwarding tokens** that the commissioner generates per intended player. Optional email-bind locks the token to a specific user's auth email. RPC `fn_redeem_invite(token)` validates and consumes.
- `/rounds/[id]/invites` UI for the commissioner to spin up invites and copy them straight into iMessage.
- `/rounds/[id]/join` accepts both PIN entry and `?invite=token` URLs.
- **"Claim your spot"** banner on the round page when an invitee hasn't linked themselves to a `round_player` yet — taps their name to set `players.profile_id = auth.uid()`.

### 4. Wager handshake
- Every round with stakes > 0 requires each invitee to acknowledge the wagers before they can score.
- `round_wager_acks` table; RLS on `scores` requires an ack row before writes.
- `/rounds/[id]/wagers` page lists all configured games with stakes humanized (e.g. "F $5 / B $5 / O $10 · auto-press 2-down · 95% allowance"). Big "I'm in" button.
- Round detail page shows a yellow-bordered banner pushing un-acked players to the wagers page.

### 5. Player & course management
- **Players directory** at `/players` — name, email/phone, GHIN #, Handicap Index, Venmo handle, avatar URL, guest flag. Inline HI editing.
- **Inline guest creation** in the new-round wizard — type a name + HI, "Add guest", they're created and immediately picked for the round. No round-trip to `/players`.
- **Courses** at `/courses` — full course wizard (name, location, tees with rating/slope/par, 18-hole grid editor for par + stroke index + yardage).
- **JGCC quick-add** — one-tap card on `/courses` that creates Jacksonville Golf & Country Club with all 5 tees from the user's actual scorecard (Black 73.2/138 · Gold 71.8/133 · Silver 70.6/120 · Jade 67.8/117 · Cranberry 70.4/125), exact pars, men's stroke index, ladies' stroke index on Cranberry, and yardages per hole.

### 6. Round setup wizard (`/rounds/new`)
- Step 1 — **Basics**: date, holes (9/18), course.
- Step 2 — **Players**: multi-select from directory; inline guest creation; per-player tee selection.
- Step 3 — **Teams** (optional): adjustable team count (0–6); **🎲 Random pairings** button (Fisher-Yates shuffle); drag-and-drop player → team buckets.
- Step 4 — **Quick-Start packages**: 7 pre-built game configs ("Gentleman's bet", "Friendly Nassau", "Aggressive Nassau", "Quarter skins", "Canadian skins", "Three-way", "Members' day"). One tap fills in stakes + allowances + config.
- Step 5 — **Games**: per-game-type editors. Nassau exposes front/back/overall stakes individually + auto-press toggle. Skins expose tie behavior (split/carry/nullify), escalation (flat/linear/double), and skin value. Best ball / aggregate / individual show stake + allowance %. CTP / long drive let you specify which holes.

### 7. Game engine ([lib/games/](../lib/games/))
- **Pure TypeScript**, no DB calls. Each game implements a `(input) → output` contract; output is a `Map<player_id, { delta_cents, breakdown[] }>`.
- **Zero-sum invariant** asserted in tests for every game on every input.
- All money in **integer cents** (BIGINT in Postgres) — no float drift.
- Supported games:
  - **Individual gross/net** stroke play with tie splits
  - **2-man best ball** (gross/net) — match or stroke flavor
  - **Team aggregate** (gross/net)
  - **Skins** (gross/net) — configurable ties (split default, carry, nullify), escalation (flat/linear/2×), and unclaimed-pot rules
  - **Canadian skins** — birdie validates, otherwise generic skins flags apply
  - **Nassau** — front/back/overall, match-play or stroke, optional auto-press at 2-down
  - **Match play** (overall-only single match, derived from Nassau)
  - **6-6-6 partner rotation** (4-player only) — auto rotates partners across three 6-hole segments (AB-CD, AC-BD, AD-BC), best-ball within each
  - **CTP / Long drive / Custom** — manual-entry pots
- **Settlement**: all game deltas summed per player, then **greedy minimum-flow** algorithm produces the smallest set of "X pays Y $Z" transfers. Persisted to `settlements` on finalize.

### 8. Handicap math ([lib/handicap.ts](../lib/handicap.ts))
- WHS 2024 formula: `Course HC = round( HI × (Slope/113) + (CR − Par) )`
- Per-game **playing handicap** with allowance% (95% individual stroke play, 85% four-ball, etc.)
- **Stroke allocation** by hole using `course_holes.stroke_index`, with wraparound for HC > 18 and "give-back" for plus handicaps.
- Optional ESC caps: `none`, `triple_bogey`, `double_bogey_plus` (WHS Net Double Bogey).
- 9-hole halving when 9-hole rating isn't published.
- 17 unit tests covering every edge case.

### 9. Live scoring
- **`<ScorePad>` component** — premium mobile-first score input shared by the real round and the demo.
  - Big +/− buttons (16/20 sq) with `active:scale-95` press feedback
  - Score chip rail (1–9) for instant tap-to-set
  - Outcome label flashes BIRDIE / PAR / BOGEY / DOUBLE in serif tracked caps
  - Hole strip with mini-scores baked in, gold dot indicating strokes received that hole
  - **Swipe gestures** to advance/retreat between holes on mobile
  - Auto-advance to next hole 480ms after a tap
  - **Live team panel** — partner's score on the current hole + best-ball/aggregate computed live
- Realtime: `/rounds/[id]` page subscribes to `scores` table changes via Supabase Realtime and patches the leaderboard live for everyone watching.
- Audit trail: `score_events` table logs every score write (old → new, who, when) via a Postgres trigger.
- **Scorecard photo OCR** at `/rounds/[id]/upload` — phone-camera input → server-side OCR (`gpt-4o` vision via OpenAI, falls back to blank grid if `OPENAI_API_KEY` not set) → review-and-save grid. Never auto-finalizes.

### 10. Leaderboard
- **`<Leaderboard>` component** — deep-green header with the brand mark, gold-accent tab strip (Gross / Net / Skins / Team / Bets), white content area, sticky tab strip on mobile.
- Columns desktop: Pos · Player · Today · Thru · Front · Back · Total · Net.
- Columns mobile: Pos · Player · Today · Thru · Net (5-column collapse).
- Position numbers in gold serif, under-par TODAY in red, "F" replaces Thru when finished.
- Skins tab shows hole-by-hole highlights. Team tab shows team-game per-player deltas. Bets tab shows aggregated projected payouts.

### 11. Public spectator leaderboard
- `/rounds/[id]/leaderboard?token=…` — token-keyed read-only view, no auth required.
- Live updates via Supabase Realtime under the service role.
- One-tap **Share link** copies the URL.
- **OG meta tags** auto-attach the share PNG (see #12) so iMessage/WhatsApp/Slack unfurl the leaderboard image inline.

### 12. End-of-round share image
- API route `/api/share/round/[id]/image` returns a **1200×630 PNG** rendered with `next/og` (Satori).
- Augusta-green panel, top 5 net leaderboard, settlement chips ("Cruz → Jeff $14"), brand mark in the corner.
- Cached 30s. Available as a "Share image" button in the round header and as an "Open / Download PNG" pair on the finalize screen.

### 13. Player profile + stats (`/players/[id]/stats`)
- Avatar (Google photo if linked, otherwise initials in a gold-ringed circle).
- KPIs: rounds played, avg gross/18, avg net/18, **avg @ JGCC** specifically, season net (in $), holes played.
- **Scoring distribution**: eagles+, birdies, pars, bogeys, doubles, triples+ — count and % of holes.
- **Venmo card** with handle + scannable QR code (pre-fills the amount they currently owe via `venmo://paycharge?recipients=…&amount=…`).
- Recent rounds list (gross / vs-par / net per round).
- Commissioner-only inline profile editor (display name, HI, GHIN, email, phone, Venmo, avatar URL).

### 14. Group ledger (`/ledger`)
- Running who's-up/who's-down across every finalized round in the group.
- Same gold-accent leaderboard styling.
- Recent settlements list links back to each round.

### 15. Demo mode (`/demo`) — guided 8-step tour
- Replaces what was previously a static screenshot grid.
- Steps:
  1. **Saturday morning at the club** — the foursome, the bets
  2. **Build the round in 90 seconds** — course + 4 players selected
  3. **Pick the games** — quick-start package grid
  4. **Set the stakes / handshakes** — wager confirmation
  5. **Score with one thumb** — embedded interactive ScorePad
  6. **Watch the standings move** — leaderboard with **simulated** score updates ticking in every 1.1s
  7. **Settle up** — final standings + Venmo cards
  8. **Sign up CTA**
- Progress bar, **▶ Auto** button (8.5s/step), Prev/Next sticky on mobile, "Skip the tour" link.
- Static demo screens still accessible: `/demo/round`, `/demo/round/score`, `/demo/profile`, `/demo/ledger`. Renders live components fed by `lib/demo.ts` fixture data.

---

## Database schema

Postgres on Supabase. RLS on every table.

| Table | Purpose |
|---|---|
| `profiles` | Supabase auth user + display_name + avatar_url |
| `groups` | A recurring golf group (multi-tenancy boundary) |
| `group_members` | Profile ↔ group ↔ role (commissioner/player/spectator) |
| `players` | Directory of golfers per group; can be guests (no profile_id); has venmo_handle + avatar_url + handicap_index |
| `courses`, `course_tees`, `course_holes` | Course data with per-tee rating/slope/par + per-hole par/SI/yardage |
| `rounds` | A round of golf — date, course, status (draft/live/finalized), PIN, access_mode, spectator_token, settings |
| `round_teams` | Teams within a round |
| `round_players` | A player participating in a round, with their tee + handicap snapshot + team |
| `round_games` | Each game configured on a round (game_type + stake + allowance + jsonb config) |
| `round_invites` | Single-use invite tokens (intended_for_name, optional intended_email, redeemed_at) |
| `round_invitees` | Profiles allowed to write scores to this round |
| `round_wager_acks` | Wager handshake confirmations per (round, profile) |
| `scores` | Hole-by-hole gross score per round_player, with audit trigger |
| `score_events` | Append-only score-write audit log |
| `manual_entries` | CTP / long-drive / custom side-bet winner picks |
| `scorecard_uploads` | OCR'd photo uploads with parsed result |
| `settlements` | Who-pays-whom rows on finalize |

Helper RPC: `fn_join_round(round_id, pin)`, `fn_redeem_invite(token)`. Definer functions for safe PIN validation past RLS.

Migrations in `supabase/migrations/` 0001 → 0006:
- 0001 init schema + RLS
- 0002 demo seed (Saturday Crew + JGCC + live + finalized round)
- 0003 round access (PIN, invitees)
- 0004 invites + stats indexes
- 0005 wagers + tightened scores RLS
- 0006 venmo + avatar columns

---

## What's NOT done yet

Be skeptical — these are gaps, possible bugs, or open product questions worth poking at:

1. **GHIN integration** — there is no public GHIN API; we currently rely on manual HI entry, with an adapter shape ready for a future GPA approval. No live handicap refresh.
2. **Manual presses for Nassau** — the engine supports `presses: "auto_2_down"` and `presses: "manual"` flags but there's no UI for the commissioner to add a press mid-round. The user explicitly asked for this.
3. **Wolf, Vegas, Bingo Bango Bongo, Hammer, Quota, Stableford** — listed in marketing copy but not yet implemented in the engine. Stableford and Quota are the most asked-for; Wolf is the most fun.
4. **Multiple commissioners per group** — currently the group founder is the only commissioner; UI to grant the role to others is missing.
5. **Offline / PWA score queue** — no service worker for dead-zone holes. PWA is installable but doesn't queue writes when offline.
6. **Push / SMS notifications** — "round started", "your turn", "you owe $X" — designed for, not built.
7. **Stat dashboards beyond per-player averages** — no putts/GIR/fairways tracking; could be added on the score-entry UX with optional fields.
8. **Voice score entry** — explicitly deferred per user direction.
9. **Per-press history table** — Nassau presses currently only log the result; granular per-hole press tracking would let us animate them.
10. **Round templates** — clone last week's round in one tap. Would dramatically cut setup time for the regular Saturday.
11. **Course library** — currently only JGCC has a quick-add preset. A wider catalog (or a paid Course Data API integration) would help users skip the manual hole-by-hole input.
12. **Real shot tracking, GPS, rangefinder** — out of scope but worth considering long-term.
13. **Multi-day events** — schema is per-round; tournaments spanning multiple rounds aren't first-class.
14. **Internationalization** — only USD, only WHS, only English.

---

## Open questions for ChatGPT review

Specific things worth a critical pass:

1. **Settlement engine correctness.** `lib/games/skins.ts` had a "split ties" zero-sum bug recently fixed. Are there other game configurations where the engine could mint or destroy money? Particularly: Canadian skins with carry+escalation+birdie validation interacting with all-tied holes, Nassau with auto-presses crossing the 9th hole, 6-6-6 with non-default rotations.
2. **Mobile UX of ScorePad.** Bigger problem to solve well — does the current swipe + chip rail + outcome label feel right, or is there a smarter pattern (e.g., a wheel picker, or just "at par / +1 / +2" instead of explicit numbers)?
3. **Discoverability of the demo.** Right now the landing page has a "See it in action" button. Is the demo guided enough to convert a skeptical visitor in 60 seconds?
4. **Wager handshake friction.** Players must tap "I'm in" before scoring. Is that the right gate or should it be hidden / softer? Does it kill momentum on day-of?
5. **Player/profile linking flow.** The "claim your spot" banner is meant to map a fresh signup to an existing player record the commissioner pre-created. Is that intuitive enough, or should we just match by email automatically?
6. **What's missing from the marketing site** to actually convert a Jacksonville club commissioner who currently uses a spreadsheet? What objections need to be addressed?
7. **Pricing model.** Currently zero — free for everyone. What's a defensible model? Per-group-per-month, per-event, freemium with paid tiers (more advanced games, custom branding)?
8. **Competitor differentiation** — Golf Genius, 18Birdies, Grint, GolfStatus, V1 Game. What's our wedge? Currently leaning into "private group / wagers / dead-simple" as the angle.

---

## Code map

```
golf-games-app/
├── app/
│   ├── page.tsx                   landing
│   ├── layout.tsx                 root html + fonts + metadata
│   ├── globals.css                tailwind + theme
│   ├── manifest.ts                PWA manifest
│   ├── (app)/                     authenticated app shell
│   │   ├── layout.tsx             navbar + bottom tabs
│   │   ├── dashboard/page.tsx
│   │   ├── players/               players + /players/[id]/stats
│   │   ├── courses/               courses + /courses/new + jgcc-quick-add.tsx
│   │   ├── rounds/
│   │   │   ├── new/page.tsx       round wizard
│   │   │   └── [id]/              round detail + score + finalize + invites + join + wagers + upload
│   │   └── ledger/page.tsx
│   ├── rounds/[id]/leaderboard/   public spectator (no auth, token-keyed)
│   ├── demo/                      guided tour + static screens
│   ├── api/
│   │   ├── scorecard-ocr/         OCR endpoint
│   │   └── share/round/[id]/image OG image generator
│   ├── auth/callback/             Google OAuth callback
│   └── auth/signout/              POST /auth/signout
├── components/
│   ├── Logo.tsx                   <img>-based wrapper for the brand asset
│   ├── BrandLockup.tsx            icon ± optional CRUZ live text
│   ├── Leaderboard.tsx            shared leaderboard with tabs
│   ├── ScorePad.tsx               premium mobile score input
│   ├── VenmoQR.tsx                server-rendered SVG QR
│   └── GoogleAuthButton.tsx
├── lib/
│   ├── handicap.ts                WHS math + tests
│   ├── scoring.ts                 player sheets + leaderboard
│   ├── stats.ts                   eagle/birdie/par/bogey buckets
│   ├── types.ts                   shared types
│   ├── games/                     one file per game type + index.ts dispatcher
│   ├── presets/
│   │   ├── jgcc.ts                JGCC course data
│   │   └── game-packages.ts       Quick-Start packages
│   ├── ocr/                       pluggable scorecard OCR
│   ├── supabase/                  browser + server clients
│   └── demo.ts                    fixture data for /demo
├── supabase/migrations/           0001-0006
├── tests/                         vitest unit tests (29 currently)
├── docs/
│   ├── PRD.md
│   ├── DATABASE_SCHEMA.md
│   ├── HANDICAP_LOGIC.md
│   ├── BETTING_LOGIC.md
│   ├── INTEGRATIONS.md
│   ├── USER_FLOWS.md
│   ├── UI_PLAN.md
│   ├── MVP_PLAN.md
│   ├── ROADMAP.md
│   ├── WALKTHROUGH.md
│   └── PROJECT_OVERVIEW.md        ← this file
└── public/cruz-logo.png           the brand mark
```

---

## How to run

```bash
cp .env.example .env.local
# Fill: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#       SUPABASE_SERVICE_ROLE_KEY, optional OPENAI_API_KEY
npm install
npm run dev          # http://localhost:3000
npm test             # vitest, 29 tests
npm run typecheck    # tsc --noEmit
```

To populate Supabase: paste migrations 0001 → 0006 (and 0002 last, after first signup) into the Supabase SQL editor.

Demo at `/demo` works without Supabase (no auth, no DB) — uses `lib/demo.ts` fixtures.

---

## Tone we're going for

Private golf club. Premium men's-day energy. "Skins. Nassau. Settle up." Not "WHS-compliant rules engine." The marketing copy, the gold-on-emerald palette, and the serif-heavy typography are all serving that brief.
