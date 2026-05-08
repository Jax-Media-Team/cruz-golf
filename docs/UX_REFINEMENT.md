# UX Refinement Plan

A prioritized issue list, recommended changes, and a code-change plan against the 12-item refinement pass.

Status legend: ✅ shipped this turn · ⏳ planned for next turn · 📝 documented only

---

## Priority order

P0 — visible/structural fixes (ship now):
1. **#3** Rename Round → Leaderboard on the live round screen
2. **#4** De-foursome language across landing, demo, copy
3. **#5** Surface multi-game support clearly (chip strip on round page, summary in wager screen)
4. **#8** Homepage copy rewrite (golfer-facing) + better feature grid
5. **#1** Logo: confirm transparent + standalone (asset already replaced)

P1 — onboarding & narrative:
6. **#2** Homepage CTA flow → "Create Account" (vs. "Create your group")
7. **#6** Smack Talk recap on finalized round
8. **#7** Demo: stronger captions + multi-game emphasis

P2 — direction & infra:
9. **#11** Deployment to Vercel + Git
10. **#9** Brand-name brainstorm (no rename yet)
11. **#10** Subscription-ready architecture (no payments yet)
12. **#12** Full QA pass

---

## Issue 1 — Logo / nav

**Now:** asset at `public/cruz-logo.png` is icon-only and transparent (gold crossed irons + golf ball with "C"). `BrandLockup` defaults to `iconOnly` so no text is rendered alongside. Sizes bumped to 120px desktop / 72px mobile in the navbar, 128px on the landing page, 120px on auth pages, 104/68px on the leaderboard banner.

**Status:** ✅ done last turn. If anything still looks small, it's browser cache — hard-refresh.

---

## Issue 2 — Homepage CTA confusion

**Now:** primary CTA is "Create your group" which conflates account creation with group creation. New visitors don't know what they're signing up for.

**Recommendation:**
- Three-step mental model in the marketing copy:
  1. **Create your account**
  2. **Create your first group** (Saturday Crew, Members' Day, etc.)
  3. **Start a round**
- Header CTAs: **Create account** (primary), **Sign in** (ghost). Demo is a secondary card below the hero.
- On the signup screen, lead with "Create your account" and treat group creation as a single inline field below — same flow under the hood, clearer label.
- After signup, dashboard shows an **empty-state checklist** (Add a course → Add players → Start your first round) instead of the current "No rounds yet" stub.

**Code changes (this turn):**
- `app/page.tsx` — relabel CTAs (Create account / Sign in)
- `app/signup/page.tsx` — clarify: top label "Create your account", subhead "Your group is ready in one click"
- `app/(app)/dashboard/page.tsx` — empty-state shows a 3-step checklist with links

**Status:** ✅ shipping this turn.

---

## Issue 3 — "Round" should become "Leaderboard"

**Now:** logged-in round detail page has a date+holes eyebrow and a course headline. The "Leaderboard" framing only appears inside the leaderboard component banner.

**Recommendation:**
- Page eyebrow becomes "Live Leaderboard · {course} · {date}"
- Browser tab title: "Leaderboard · {course}"
- Bottom-nav and side-nav still say **Rounds** (the list view is rounds; this is the leaderboard for one).
- Demo navbar's "Round" link relabels to "Leaderboard".

**Code changes:**
- `app/(app)/rounds/[id]/page.tsx` — eyebrow + page title metadata
- `app/demo/layout.tsx` — relabel demo nav

**Status:** ✅ shipping this turn.

---

## Issue 4 — De-foursome the language

**Now:** copy across landing, demo, and walkthroughs leans on "foursome", which excludes 8-player men's days, multi-group club events, etc.

**Recommendation:** consistent vocabulary:
- **Group** — the umbrella (a recurring set of golfers)
- **Round** — one specific date/course
- **Players** — anyone in a round
- **Event** — a single round with multiple groups (men's day, club outing)

Replace "foursome" with "group" or "players" everywhere user-facing. Reserve "foursome" for places where the literal 4-player team is meant (best ball, partner pairings).

**Code changes:**
- `app/page.tsx` — copy update
- `app/demo/page.tsx` (tour) — copy update
- `docs/PROJECT_OVERVIEW.md` — narrative tweak

**Status:** ✅ shipping this turn.

---

## Issue 5 — Multiple games / bets in one round

**Now:** the engine already supports running many games on one round (`round_games` is a 1:N relation; the round detail page settles each game separately and aggregates payouts on the Bets tab). It's just not visually obvious in the UI.

**Recommendation:**
- **Round page**: top of the leaderboard, show a horizontally scrolling **chip strip** of every game configured ("Skins · Net · $1" / "Nassau · 5/5/10" / "Best Ball · $10"). Tapping a chip filters/highlights.
- **Wager handshake**: already lists each game; reaffirm the per-game stake total at top.
- **Bets tab**: split projected payouts by game *and* aggregated total.
- **Settlement**: keep per-game line items, then one combined "Net for the day" summary row.

**Code changes (this turn):**
- New `<GamesStrip>` component on the round detail page
- Demo round page also gets the chip strip

**Status:** ✅ shipping this turn.

---

## Issue 6 — Smack Talk / round recap

**Now:** finalize screen shows by-game P/L and the minimum-flow settlement, but no narrative. Players miss the bar-friendly story.

**Recommendation:** generate 4–8 "moments" from the round data and present them as a **stacked card series** at the top of the finalize screen and in the share image.

Categories to detect (designed to be funny, not mean):

| Moment | Trigger |
|---|---|
| 💰 Biggest skin | Hole with the largest single-skin pot |
| 🎯 Hot stretch | Longest run of par-or-better by any player |
| 🔥 Birdie run | 2+ consecutive birdies |
| 💸 Most expensive hole | Single hole where the most money changed hands |
| 🪂 Comeback kid | Player whose back-9 vs front-9 swing was largest |
| 👯 Carried by partner | In best ball — partner contributed the team-low score on >50% of holes |
| 🪦 Dead money | Player who finished negative on every game configured |
| 🥇 Take the W | Top season earner is winning *again* |
| 🍀 Birdie validates | A Canadian skin that survived because the par broke |
| 🤡 Worst hole | Single biggest blow-up vs par by anyone |

Implementation: pure function `lib/recap.ts` that takes round data and returns `Moment[]`. UI component `<RecapCards>`. Wire into:
- `/rounds/[id]/finalize` — render above the by-game breakdown
- `/api/share/round/[id]/image` — squeeze the top 2 moments into the OG card
- `/demo` tour — recap appears as part of the Settle Up step

**Status:** ✅ shipping this turn (engine + cards + finalize screen). OG image hookup deferred.

---

## Issue 7 — Demo needs to sell

**Now:** demo is a guided 8-step tour that's already built but light on captions, doesn't yet emphasize multi-game tracking, and skips account creation framing.

**Recommendation:**
- Add a "**This replaces Golf Genius / spreadsheets for our regular money game**" headline above step 1
- Step 1 expands to show "Sign up → Create group → Pick course → Add players" as a flowing strip (not separate steps)
- Step 4 (games) makes multi-game obvious: show 3 games selected at once with stakes
- Step 6 (leaderboard) adds a caption "Watch all 3 games settle in real time"
- Step 7 (settlement) gets a Smack Talk recap section
- Captions get a subtle gold left-border accent so they feel like guided narration, not just text

**Code changes:**
- Update `app/demo/page.tsx` step content
- Add Smack Talk preview to settlement step

**Status:** ⏳ partial this turn (Smack Talk in settlement step, captions enhanced); deeper interactive walkthrough next turn.

---

## Issue 8 — Homepage content rewrite

**Now:** copy is too engineering-flavored ("Currency Drift", "Locked rounds", "WHS formula").

**New copy direction (shipping):**

Hero
- Eyebrow: "For private golf groups · invite only"
- H1: **Your Saturday game,** *finally organized.*
- Subhead: *Skins. Nassau. Best Ball. Settle up before you leave the parking lot.*
- Tagline: *Live scoring for private golf groups, member games, and small club events.*

Feature grid (6 cards):
1. **Game types** — Skins. Nassau. Best Ball. 2-Man. 6-6-6. Wolf. Quota. Gross + Net.
2. **Live scoring** — Hole-by-hole entry from every player's phone. Leaderboard updates in real time for the whole group.
3. **Handicaps** — Automatic course handicap and stroke allocation. Plus handicaps and 9-hole rounds handled.
4. **Wagers & Settlements** — Track every press, payout, and skin. Final tally pre-fills Venmo with the right amount.
5. **Private groups** — Invite-only access. Per-round PIN, single-use invites, no public listings.
6. **Scorecard upload** — Snap a photo of a paper card, OCR drops the scores into the grid for review.

Bottom strip: "Built for member games, regular groups, and small club events."

**Status:** ✅ shipping this turn.

---

## Issue 9 — Brand naming options

**Naming brainstorm (for future consideration — keep "Cruz" today):**

Crossed-clubs / cross etymology
- **Cruz Golf** *(current — pun on "cross", clubs form a cross)*
- **Saltire Golf** *(saltire = the X cross; subtle, country-club lexicon)*
- **The Crossed Club**
- **Cross Course**
- **Two Irons**

Saturday-game / clubhouse vibe
- **Saturday Pin** / **Saturday Game**
- **The Foursome** *(only if you accept the foursome-only feel)*
- **The Tab** *(for the bet — fun, casual)*
- **Settle Up Golf**
- **Members' Day**
- **The Skins App**
- **Pin High**

Game-culture / wagering
- **Press / Press Golf** *(wager term, short, ownable)*
- **Sandbagger** *(playful name for the betting culture)*
- **Pot's Open**
- **Carry** *(skins term, single word, deep)*
- **Stakes** *(simple, premium, golf-adjacent)*

Premium private-club
- **Black Tee**
- **The Member's Card**
- **Honors Golf** *(honors = right to tee off first; clubby)*
- **Quota Club**
- **Eighteen** *(the round)*
- **Front Nine**

My pick if you wanted a rebrand: **Press Golf** (single, ownable word that's deep in the culture) or **Saltire** (premium, geometric, lets the icon stay literal). **Stakes** is the most marketable.

Whatever you pick, keep the icon — the crossed clubs translate to any name in the list.

**Status:** 📝 documented only.

---

## Issue 10 — Subscription model architecture

**No payments now.** What needs to be in place so we can layer pricing on later without schema migrations:

**Already in place / no work needed:**
- `groups` table is the natural billing boundary (one subscription = one group)
- `group_members.role` already supports `commissioner` / `player` / `spectator`
- All money math is in cents (matches Stripe)

**What to add (when ready, not now):**
- `groups.tier` — `free | club | event` with feature gates checked in middleware
- `subscriptions` table — Stripe customer/subscription IDs, period_end, status
- `feature_flags` view — derives entitlements from tier
- A "billing owner" concept (defaults to `groups.owner_id`)
- Per-feature gates: premium game types (Wolf, Vegas, custom side bets), custom branding (logo upload), event mode (>20 players, multi-tee), exports

**Pricing options to validate (no decision needed today):**
- **Free private beta** — what we have now
- **Per-group / month** — $9–19/mo for the commissioner; players are free
- **Per-event** — $4.99/event for one-off members' days, no recurring
- **Club / event package** — $99/mo or $499/yr for clubs running 4+ events/yr
- **Premium game pack** — $4.99/mo or one-time $19.99 unlocks Wolf/Vegas/Custom

Recommended path: **free for invited players forever**, **commissioner pays a small monthly fee** ($9–14 range) once the group runs a 3rd round in a calendar month. Big enough to monetize active groups, small enough that the commissioner just absorbs it as "the cost of running our game."

**Status:** 📝 documented only. Schema is already compatible.

---

## Issue 11 — Deployment

**Where the project lives:**
- Local path: `C:\Users\patri\Documents\golf-games-app`
- **Not in Git yet** — no `.git/` directory. No GitHub repo exists.
- **Not deployed** — runs locally only at `http://localhost:3000`.

**To get to a live URL:**

1. **Initialize Git locally** (I'll do this in a separate, confirmed step):
   ```bash
   cd /c/Users/patri/Documents/golf-games-app
   git init
   git add -A
   git commit -m "Initial commit: Cruz Golf scaffold"
   ```

2. **Create the GitHub repo** in your `Jax-Media-Team` org. Easiest path:
   - In your browser: https://github.com/organizations/Jax-Media-Team/repositories/new
   - Name: `cruz-golf` (or whatever final brand)
   - Visibility: **Private** (recommended for now)
   - Skip README/.gitignore — we already have them
   - Then locally:
   ```bash
   git remote add origin https://github.com/Jax-Media-Team/cruz-golf.git
   git branch -M main
   git push -u origin main
   ```

3. **Deploy to Vercel:**
   - Sign in at https://vercel.com (use the Jax Media Team workspace).
   - Import the GitHub repo.
   - Framework preset auto-detects Next.js.
   - **Environment variables** — paste these into Vercel project settings:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY` (mark as "Sensitive")
     - `OPENAI_API_KEY` (optional, for scorecard OCR)
     - `APP_URL` = `https://<your-project>.vercel.app` (update after first deploy)
   - First build takes ~3 min.

4. **Supabase setup** (required for the live URL to work end-to-end):
   - Project at https://supabase.com → New project
   - Run migrations 0001 → 0006 in order from `supabase/migrations/` in the SQL Editor
   - Run `0002_seed.sql` *after* you've signed up at least once on the live URL — it links the demo group to your profile
   - Auth → Providers → enable Email + (optional) Google OAuth. For Google, add `https://<your-project>.supabase.co/auth/v1/callback` to the OAuth client's Authorized redirect URIs in Google Cloud.
   - Auth → URL Configuration → Site URL = your Vercel URL, plus `http://localhost:3000` for dev

5. **Custom domain (optional, later):**
   - Vercel → Settings → Domains → add `cruzgolf.com` (or whatever)
   - Vercel auto-provisions an SSL cert
   - Update `APP_URL` env var to the custom domain

**Picking it back up later:** everything is on disk + Git. Reopen `golf-games-app` in your editor, `npm run dev`, and you're back. No state lives outside the repo + Supabase project + Vercel project.

**Status:** ⏳ shipping `git init` + initial commit this turn (local only). GitHub push and Vercel deploy require your account, so I'll prep but not click through.

---

## Issue 12 — QA pass

A first-time-user walkthrough, in order:

| Step | Issue | Severity | Fix |
|---|---|---|---|
| Land on `/` | "Create your group" CTA confuses new users — they think they need to know what a "group" is first | High | ✅ Switch to "Create account" + "Sign in"; explain group on signup |
| Land on `/` | "Currency drift / Round PIN / Required / Zero" stat block is cryptic | High | ✅ Replace with 6 golfer-facing feature cards |
| `/signup` | Single form for account+group+name confuses people who didn't read the homepage | Medium | ✅ Clarify section labels: "Create account" / "Name your first group" |
| `/dashboard` (empty) | Just says "No rounds yet" — no path forward | High | ✅ 3-step checklist: Add a course → Add players → Start your first round |
| `/courses` | JGCC quick-add card is great. New non-JGCC users won't know that. | Low | 📝 Future: add quick-adds for popular FL courses (TPC Sawgrass, Hidden Hills, etc.) |
| `/players` | No way to bulk-import / paste a list | Medium | 📝 Future: paste-multi-name dialog |
| `/rounds/new` | "Quick start" packages are great. But the labels emoji/tone may feel too casual for some clubs | Low | 📝 Future: switch to icon set |
| `/rounds/new` | Inline guest-add is great | n/a | ✅ Already in place |
| `/rounds/new` | After "Start round" there's no "what next" prompt for the commissioner | Medium | ⏳ Banner on round page: "Share this round with your group" |
| `/rounds/[id]` | "Round" label is unclear — is this a leaderboard? | High | ✅ Reframe as "Live Leaderboard" |
| `/rounds/[id]` | Multiple games configured but only the active tab is visible — feels like one game | High | ✅ Add games chip strip at top |
| `/rounds/[id]/score` | ScorePad is good now. The chip rail at bottom on small phones can feel cramped | Low | 📝 Future: smarter break to 2 rows on narrow widths |
| `/rounds/[id]/wagers` | Players who don't understand the bet may feel stuck. | Medium | 📝 Future: tooltip per game with plain-English rules |
| `/rounds/[id]/finalize` | "By game" + "Who pays whom" is functional but cold | High | ✅ Add Smack Talk recap above |
| `/ledger` | Fine | n/a | — |
| `/players/[id]/stats` | Avatar fallback is just initials — looks weak when nobody has Google sign-in yet | Low | 📝 Future: pull avatars from Gravatar via email hash |
| Mobile leaderboard | Today column may not fit super-long names | Medium | ⏳ Truncate names to 12 chars with ellipsis |
| Mobile bottom nav | "Players / Courses / Ledger" is fine. Demo nav has "Round" — confusing | Medium | ✅ Demo nav relabels to "Leaderboard" |
| Demo at `/demo` | Auto-mode steps too fast for some viewers | Low | 📝 Future: gear icon for cadence |
| Demo step 6 | Simulated updates are great but the "what changed" indicator could be clearer | Medium | 📝 Future: brief flash on changed rows |
| Demo step 8 (CTA) | The "Sign up. Add players. Tee it up." CTA is good but doesn't drop the user into a guided onboarding when they sign up | Medium | 📝 Future: pass `?from=demo` flag to signup, show condensed onboarding |

---

## Tone we're going for (re-stated)

Private club. Premium men's-day energy. "Skins. Nassau. Settle up." Not "WHS-compliant rules engine." Three words on every page should sound like something Cruz would say at the bar after the round, not an engineering spec.
