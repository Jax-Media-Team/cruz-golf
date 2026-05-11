# Cruz Golf — Claude Code project context

**Read this before doing any work in this repo.** It's the load-bearing context that turns a cold session productive in 30 seconds. The detailed roadmap lives in `ISSUE_TRACKER.md`; this file is the *posture* — voice, principles, decisions already made, things to never re-litigate.

---

## 🌅 NEXT SESSION START HERE (snapshot 2026-05-11)

**Current system status: ✅ healthy and deployed.**

- **Latest commit on main:** `2114d4e` — *chore(tone): strip cartoon emoji from records / leaderboards / stats*
- **Branch:** `main` (working tree clean, in sync with origin)
- **Production URL:** https://cruz-golf.vercel.app
- **Test suite:** **480/480 passing across 32 test files.** Run with `npm test -- --run` from project root.
- **Typecheck:** clean (`npx tsc --noEmit`)
- **Migrations applied through:** `0038` (The Plantation at Ponte Vedra Beach). Migration 0040 (event lifecycle RPCs) drafted and awaiting Patrick's "applied" confirmation.

### Recent stretch (2026-05-11)

Patrick directive: "real-world validation pass" — real-round 6-6-6 press
testing, OCR mobile UX, live match clarity. Shipped:

1. **OCR diagnostics + mobile mapping UX** (`a255ec4`). Each OCR card
   now exposes a `_debug` payload (raw model text, pre/post-coerce
   shape). Upload UI renders a per-card diagnostics `<details>` panel
   with per-row outcomes (`merged` / `unmatched_panel` /
   `dropped_no_name_no_scores`). Mapping panel restructured for narrow
   viewports — meta on top, select + Merge/Skip below.

2. **6-6-6 full-round press tests** (`a255ec4`,
   `tests/six-six-six-full-round.test.ts`). End-to-end pipeline exercise:
   `settleGame` (6-6-6 + auto-presses) + `settleManualPress` (accepted
   presses) combined via a `settleAcceptedManualPresses` helper that
   mirrors `finalize-view.tsx`. Three scenarios cover auto press in
   seg 1, accepted manual on seg 2, declined/withdrawn/pending presses
   on seg 3, and partner-rotation isolation.

3. **Live auto-press chain on round-view** (`0da247a`,
   `lib/games/live-state.ts` + tests). Each `LiveSegment` now carries
   `auto_presses: LiveAutoPress[]`. The round-view renders an amber
   dot + status line for each open press ("Press 1 · opened hole 2 ·
   Pat + Ben up 1 thru 2"), dimming settled presses. Wired for Nassau,
   6-6-6, and team_match game families.

4. **Rank-movement indicators** (`72822fe`,
   `lib/leaderboard-movement.ts` + `lib/use-row-movement.ts` + tests).
   Both the round-level `<Leaderboard>` and `<EventLeaderboard>` now
   surface ↑n / ↓n indicators next to a position when a player's rank
   shifts. 6-second TTL, emerald-up / red-down, no animation beyond
   opacity fade. First paint is always indicator-free (no baseline
   means no signal). Reset on tab switch via `key={mode}`.

5. **Event leaderboard tied positions** (`7ebf922`,
   `rankWithTies()`). Two players at the same vs-par score now share a
   position with a `T` prefix ("T1, T1, 3" instead of "1, 2, 3"). Pure
   helper, six tests covering no-ties / 2-way / 3-way / empty / single
   / object-keyFn cases.

6. **OCR P0 fix** (`8f13eac` + `79faab5`). Real-world card came back
   "0 scores read" because gpt-4o was regurgitating the player list
   we passed to it instead of doing pixel work. The diagnostic panel
   showed the model returning "Patrick Cruz" verbatim when the card
   had pencil "Cruz (5)". Fixes:
   - Removed the player list from the OCR prompt entirely. The
     application's bestMatch fuzzy matcher handles name disambiguation
     downstream. Hard "no hallucinated names" rule in the prompt.
   - Added `detail: "high"` so the API stops downsampling — fatal for
     pencil handwriting on a paper card.
   - `temperature: 0` for deterministic output.
   - Auto-retry once when the first pass returns rows-but-no-scores
     (the "model gave up" failure mode), with a higher temperature
     and a focused addressing of the failure.
   - Image thumbnail + Retry button in the diagnostics panel; new
     debug fields (model, image bytes, called_at, attempts,
     first_attempt_raw) for traceability.

7. **PWA / iOS audit** (`f28a8c2`). Three issues caught from code:
   `app/manifest.ts` collided with `public/manifest.webmanifest`
   (deleted the dynamic route — the static one is more complete).
   Added `viewport-fit: cover` so iPhones with notches don't
   letterbox. Dropped `maximumScale: 1` (accessibility — pinch-zoom
   now allowed). Synced theme color to `#0a1f1a` so PWA cold-start
   doesn't flash to a different green. `docs/IPHONE_PWA_QA.md`
   updated with a "Recently changed — re-install before testing"
   section.

8. **Historical event continuity roadmap** (`8f13eac`,
   `docs/HISTORICAL_EVENT_CONTINUITY.md`). Defined the
   `event_series` model + 5-phase rollout for "events have memory
   over time" (annual Member-Guest, trip history, prior-year
   champion on new event card, Ryder Cup–style cumulative). No
   implementation yet — Patrick confirmed JGCC Sunday Crew /
   member-guest / Pinehurst trip as likely first series candidates
   but wants to battle-test core workflows first.

9. **OCR client-side preprocessing** (`a0d77d3`,
   `lib/ocr/preprocess.ts`). Every image goes through
   `prepareImageForOCR()` before upload:
   - EXIF auto-rotation (iPhone photos almost always carry rotation
     metadata; without applying it the model sees a sideways card).
   - Long-side cap at 2400px (matches OpenAI's detail:"high" tile
     ceiling — anything larger is server-side downsampled anyway).
   - JPEG q=0.92 re-encode for ~30% smaller payload.
   - Fast-path for files <1.5MB (skip canvas, avoid JPEG-of-JPEG).
   - Graceful fallbacks for older Safari versions.
   - Pure dimension math testable in isolation (7 cases).
   - Per-card Remove button + grid progress counter as salvage UX.
   - Explicitly NOT yet: deskew, brightness/contrast, pencil
     enhancement. Reserved for the "if simple fix isn't enough"
     path — each transform is a place to lose information.

10. **Tone cleanup** (`2114d4e`). Stripped cartoon emoji from every
    records / leaderboards / stats title and empty-state per
    CLAUDE.md's explicit rule. Kept nav-card glyphs and demo-page
    mode previews (judgment call — they're chrome, not record
    celebration).

### Highest priorities for next session

1. **Real-device iPhone PWA QA** — walk through `docs/IPHONE_PWA_QA.md` on an actual iPhone. The 9 scenarios in there can't be programmatically verified. Most likely places to find bugs: realtime over LTE with poor signal, service-worker activation timing on first install, home-indicator clearance on different iPhone models.
2. **Course library expansion** — 6 NE FL placeholders still empty (Sawgrass CC, Atlantic Beach CC, Marsh Landing, TPC Dye's Valley, San Jose, Pablo Creek). Waiting on official scorecards. **No fabrication.** When a card arrives, follow the 0034 / 0038 pattern: one tee per color, men's-only rating/slope/SI, idempotent migration, status=verified only if rating + slope are printed on the card.
3. **Manual press dispute end-to-end with a real foursome** — the engine + UI + audit are tested but the dispute workflow (`docs/ADMIN_PRESS_DISPUTE_WORKFLOW.md`) hasn't been exercised with a real "Ben says he accepted" scenario. Watch for: does the audit log surface the right info? Is the round-detail page enough to resolve it without SQL?
4. **(Lower priority) Push notifications for press requests** — not implemented. The active round pill alert (amber) + in-app banner are the only out-of-app signals. If players have the app backgrounded, they won't know about a press until they open it.

### Outstanding risks (things that could break in the field)

- **Press accept while completely offline:** intentionally NOT queued (24h expiry window + business rules make it risky). User sees "You're offline. Try again when you reconnect." and must retry manually. Confirm this is the right call after real use.
- **Service worker freshness after a deploy:** the version watcher polls every ~30s, shows a "Refresh" toast. If users dismiss + never refresh, they stay on stale code until the SW cache invalidates on next cold start. Acceptable but worth monitoring.
- **No push notifications.** Press requests rely on active app foreground. Real-world impact depends on how players actually use the app — if it stays open during a round (likely), this is fine.
- **High-handicap-mode handicap math:** tested in unit + simulation but not on every USGA edge case (plus handicaps, allowances < 50%, 9-hole-only rounds with full-round handicap).

### Important files (read first when resuming)

- `CLAUDE.md` (this file) — posture + principles + the "don't re-litigate" list
- `ISSUE_TRACKER.md` — full migration table + priority list + session execution log
- `docs/IPHONE_PWA_QA.md` — 9-scenario real-device checklist
- `docs/ADMIN_PRESS_DISPUTE_WORKFLOW.md` — admin support walkthrough
- `lib/games/press.ts` — the press engine (auto + manual)
- `lib/clubhouse.ts` — the living-clubhouse signal builders (1641 lines, 11 builders)
- `app/(app)/rounds/[id]/press-controls.tsx` — manual press UI (realtime + retry)
- `app/(app)/rounds/[id]/finalize/finalize-view.tsx` — full settlement composition
- `supabase/migrations/0038_plantation_pvb_data.sql` — latest applied migration

### Active routes / surfaces (mental map)

User-facing app (`app/(app)/`):
- `/dashboard` — clubhouse strip + rounds list + onboarding checklist (skeleton ✓)
- `/rounds/new` — create round
- `/rounds/[id]` — live round page + PressControls (skeleton ✓)
- `/rounds/[id]/score` — single-player score entry
- `/rounds/[id]/score-group` — group score entry
- `/rounds/[id]/finalize` — settlement + pending-press warning
- `/rounds/[id]/invites`, `/wagers`, `/upload`, `/games`, `/join`
- `/leaderboards`, `/records`, `/records/me`, `/records/course/[id]`
- `/players`, `/players/[id]/stats`
- `/courses`, `/courses/[id]`, `/courses/new`, `/courses/import`
- `/ledger`
- `/onboarding`

Public:
- `/login`, `/signup`, `/demo`
- `/rounds/[id]/leaderboard?token=...` — spectator
- `/rounds/[id]/leaderboard?token=...&adminMode=1` — admin spectator (gold banner)

Admin (`app/admin/`):
- `/admin` — overview + live rounds + pending presses panel + recent audit
- `/admin/audit` — full destructive-op log (filter by kind; press events deep-link to round)
- `/admin/rounds/[id]` — round inspection + **manual press lifecycle section** (status pills, opener, acceptor, timestamps)
- `/admin/users`, `/admin/groups`, `/admin/courses`, `/admin/course-library`, `/admin/feedback`

### Unfinished work (none currently in-progress)

No half-finished branches, no WIP commits, no `// TODO` markers added this stretch. If you find something stale, treat it as exploration not commitment.

### Recommended next steps (in priority order)

1. **Read this section + the migration table in ISSUE_TRACKER.md** — confirms the snapshot matches the actual state.
2. **Walk `docs/IPHONE_PWA_QA.md` on your iPhone** — file any bugs as `MOBILE-N` items in the tracker.
3. **If Patrick brings a scorecard:** add it as migration 0039 following the 0038 pattern. Test the SQL idempotency by re-running it.
4. **If a real press dispute happens:** follow `docs/ADMIN_PRESS_DISPUTE_WORKFLOW.md`. Take notes on what's missing.
5. **Otherwise:** continue working through the ⏳ items in the tracker's "Next major focus areas" section.

### Safety / reliability decisions (do NOT re-litigate)

- **Press accept is NOT queued offline.** Deliberate — 24h expiry window matters.
- **Score writes ARE queued offline** via localStorage outbox (`useScoreSaver`).
- **Round status `draft → live → pending_finalization → finalized`** — no auto-transitions, no midnight cron. Trust + recoverability over clutter cleanup.
- **Migration workflow:** SQL pasted in chat → Patrick applies via Supabase SQL editor → confirms "applied". No autonomous DDL.
- **Group-private by default.** No public social feed, no cross-group leaderboards, no strangers in records.
- **Audit log is append-only.** No UPDATE / DELETE policies. Admins can read, not edit.
- **GHIN integration: NOT implemented.** Manual handicaps only via `wrapManualIndex`. The `HandicapProviderLookup` interface is the seam for future GHIN. Local overrides always win.
- **No course-data fabrication.** Verified scorecards / USGA NCRDB / community-OCR with admin moderation only.

---

## What this is

Cruz Golf is a **Next.js 15 + Supabase** app for private golf groups. Patrick Cruz (Jacksonville, FL) is the founder and the user testing it most. Initial user base: Northeast Florida private-club golfers, member-member tournaments, gambling foursomes.

**Product north star:** *the operating system for private golf groups.*

The moat is **persistent shared history** — rivalries, partner records, group lifetime totals, course mastery, milestones, betting lore. **Not** GHIN replacement, **not** launch-monitor analytics, **not** GPS, **not** ultra-technical stat golf, **not** a public social feed.

> "Our golf history lives here" beats "We use a scorekeeping app."

---

## Tone discipline (non-negotiable)

The app voice is **member-member gambling group / golf-trip group chat / private clubhouse**. Statements, not exclamations. Confident, understated, club-like, premium, believable.

**Yes:**
- "Patrick has won 3 rounds in a row · $15 taken across the streak"
- "Mitch owns hole 4 at JGCC · 4.6 avg · 5 plays"
- "Sunday Crew · 47 rounds · $2,150 moved · together 4 years"

**No:**
- Fire emoji on streaks
- "🎉 NEW PR ALERT!!!"
- Cartoon trophies, fake achievements, badge shower
- Mobile-game / casino-app energy
- Public-feed framing ("everyone is talking about…")

The data is the interest, not the chrome. Restraint is the rule. When in doubt: write the line as a statement.

---

## 12 operating principles

These are baked in. Don't re-derive them.

1. **No duplicate UI.** If two affordances do the same thing, show one.
2. **Opinionated over configurable.** Smart defaults beat 12 toggles. Progressive disclosure for advanced options.
3. **Deterministic rendering.** A given DB state always produces the same UI. Render rules belong in pure helpers with regression tests, not inline filters.
4. **Data integrity > velocity.** Soft-delete by default. No destructive op without an audit trail and a recovery path. Golf betting/history apps cannot feel fragile.
5. **Continuous QA.** Every meaningful change gets: regression test → desktop+mobile sweep → admin/non-admin sweep → simulated round → persistence/reload check.
6. **Stop only for destructive/payments/ToS/privacy/architecture-change decisions.** Otherwise: ship.
7. **No dead ends.** Every screen has a primary next action. Empty states preview what's coming and offer a CTA.
8. **"Join the group", not "configure software".** Onboarding + copy lean crew/group/social. Group-first language: "your crew", "your group", "your weekend".
9. **The app should feel alive** — but **group-centric**, not algorithmic feed. Live signals scoped to user's own group only.
10. **Watching ≠ editing ≠ acting as admin ≠ acting as user.** Four modes, four unmistakable visuals. Banners, colors, routes never blur.
11. **Shared history is the moat.** Once a group has months of data, rivalry counts + lifetime totals + partner records are what makes it irreplaceable. Every signal we surface should feel earned, data-supported, naturally discoverable — never artificially manufactured.
12. **Tone discipline carries.** Statements not exclamations. No badges, no fire emoji, no fantasy-sports vibes, no casino psychology.

---

## Stack + architecture

- **Next.js 15 App Router** — Server / Client component boundaries respected. RSC by default.
- **Supabase** — Postgres + Auth + RLS + Realtime + Storage.
- **Postgres patterns:** SECURITY DEFINER RPCs for ops that bypass RLS (lifecycle transitions, cross-group templates). RLS for read access. Append-only audit log for destructive ops.
- **Vitest** for the engine (currently 230+ tests). No Playwright suite yet — UI work has very thin coverage.
- **TypeScript strict mode.**
- **Tailwind** with brand tokens (cream / brand-900 / gold-500). Don't introduce new design libraries.

### Source-of-truth files

- `lib/games/library.ts` — `GAME_FAMILIES` catalog (gross/net unified). Picker UIs read from here.
- `lib/games/press.ts` — generic press-detection primitive used by Nassau + Best Ball + Aggregate.
- `lib/clubhouse.ts` — pure-function signal engine for the dashboard's "living clubhouse" strip. Builders for live rounds, streaks, rivalries, partner chemistry, group lifetime, course mastery, hole mastery, milestones, biggest pot.
- `lib/courses-page.ts` — pure dedup helpers for `/courses` (regression-tested invariant: a course never appears in two sections at once).
- `lib/handicap-provider.ts` — handicap source abstraction. Manual today; GHIN slot is a placeholder. **Local overrides always win** is the safety property.
- `lib/presets/jgcc.ts` — JGCC scorecard data (single source of truth).
- `components/ClubhouseStrip.tsx` — thin presentational layer over the clubhouse engine. Capped at 4 cards.
- `components/AdminSpectatorBanner.tsx` — gold sticky banner for `?adminMode=1` spectator routes.
- `components/RoundBreadcrumb.tsx` — persistent header on every round sub-page. Owns the `statusPillFor()` helper that centralizes lifecycle-state visuals.
- `components/PhotoPicker.tsx` — camera + library both, never `capture="environment"` alone.

### Migrations workflow (important)

DDL **cannot** be applied programmatically — `POSTGRES_URL` is not in the Vercel env, and the Claude Browser MCP is blocked from executing DDL on production. The flow is:

1. Write `supabase/migrations/00NN_name.sql`
2. **Paste the SQL into chat** so Patrick can copy/paste into Supabase SQL Editor manually
3. Patrick replies "applied" → mark the migration as applied in `ISSUE_TRACKER.md`

Migrations must be **non-destructive, idempotent, additive**. Always:
- `create table if not exists ...`
- `alter table ... add column if not exists ...` (or wrap in a `do $$ ... $$` block with `information_schema` check)
- `create index if not exists ...`
- `create or replace function ...` (full body, not partial — Postgres has no partial replace)
- For seed data: `where not exists` guard before each `insert`

Re-running an applied migration must be a no-op. If you're updating an existing function, **paste the full new body** in a fresh migration; don't rely on prior context.

---

## Round lifecycle (state machine)

```
draft → live → pending_finalization → finalized
                       ↑
                       └── still editable; commissioner can resume
```

| State | Editable? | Settlements? | Visible in |
|---|---|---|---|
| draft | yes | no | Drafts bucket on /dashboard |
| **live** | yes | no | "Live now" bucket, ActiveRoundPill, Clubhouse live signal |
| **pending_finalization** | **YES** | no | "Awaiting finalization" bucket only — NOT a "live" signal |
| finalized | no (unfinalize first) | yes | "Recently finalized" bucket, records, leaderboards |

Transitions:
- live → pending: `fn_mark_round_pending(round_id)` (commissioner-only)
- pending → live: `fn_resume_round(round_id)` (commissioner-only)
- any → finalized: existing `/rounds/[id]/finalize` flow
- finalized → live: `UnfinalizeButton`

**Never add time-driven auto-transitions** (no midnight closures). Patrick explicitly DOES NOT want them. Trust + recoverability outweigh clutter cleanup.

---

## Course-data ingestion rule

When seeding course templates from a scorecard:

- **One tee per color.** Black / Gold / Blue / White / Green / Red — each as a single row, named by the bare color.
- **Men's rating + men's slope** for the rating math.
- **Men's stroke index** for handicap allocation.
- **Skip** Ladies' duplicates, combo tees (Blue/White, White/Green, Green/Red), and any specialty tees that just remix existing colors.
- **Skip** the per-tee gender split — gender lives on individual players via their handicap, not on the tee row.

Compliant data sources only:
- ✅ Publicly available scorecards (PDFs, club website)
- ✅ Scorecard photo OCR via the existing `/courses/import` flow
- ✅ Community-submitted with admin verification
- ✅ USGA's public Course Rating DB (https://ncrdb.usga.org/) for rating + slope only
- ❌ **Never** scrape, fabricate, or copy hole-by-hole data without verification

The 13 NE FL priority courses (Ponte Vedra Inn & Club Ocean + Lagoon, Timuquana, Deerwood, Sawgrass CC, Atlantic Beach CC, Marsh Landing, TPC Sawgrass Stadium + Dye's Valley, San Jose, JGCC, Pablo Creek, The Plantation) are seeded as templates. Populated + verified: JGCC, PVIC Ocean, PVIC Lagoon, TPC Sawgrass Stadium, Deerwood, Timuquana, The Plantation (7 of 13). Still placeholder: Sawgrass CC, Atlantic Beach CC, Marsh Landing, TPC Dye's Valley, San Jose, Pablo Creek (6 of 13) — waiting for scorecards.

---

## Handicap providers

**Phase 1 (today):** Manual entry only. `manualProvider` wraps user-typed handicap indexes in the `HandicapValue` provenance envelope.

**Phase 2 (later, blocked on USGA):** Real GHIN integration via official Allied Golf Association partnership. **No public API exists; no compliant scraping path.**

**Architectural seam:** `lib/handicap-provider.ts` defines `HandicapProviderLookup`, `HandicapValue`, `resolveEffectiveHandicap`. When GHIN lights up, it's a single-file swap.

**Safety property — never violate this:**
> Local overrides ALWAYS win. A commissioner's negotiated handicap is never silently overwritten by an official refresh. The override flag is explicit and persistent.

13 regression tests in `tests/handicap-provider.test.ts` cover the override-wins property. Don't break them.

---

## Admin observability (NOT impersonation)

Admins get **read-only spectator** access to any round, group, or user — never "view as user". The mechanism:

- `/rounds/[id]/leaderboard?token=XXX&adminMode=1` — re-uses the existing public spectator surface
- Server-side re-verifies admin status via `fn_is_platform_admin()` (URL flag alone can't grant the banner)
- `<AdminSpectatorBanner>` (gold) renders at the top — unmistakable

Distinct visual modes:
- **Watching** = gold spectator banner
- **Editing as admin** = NOT YET BUILT; if added, will use a distinct (red/amber) banner + opt-in route + audit log
- **Acting as user** = never. Don't do impersonation.

**Admin tooling shipped (as of 0038):**

| Surface | What it shows |
|---|---|
| `/admin` | Live rounds list + **pending presses panel** (age-colored: amber >12h, red >20h) + recent audit + counts |
| `/admin/audit` | Full destructive-op log, filter by kind, deep-link from press events back to round |
| `/admin/rounds/[id]` | Round inspection + **full press lifecycle section** (status pill, sides, opener, acceptor/decliner/withdrawer, timestamps) |
| `/admin/users` | Per-user view |
| `/admin/groups` | Group inspection |
| `/admin/courses` + `/admin/course-library` | Course moderation (verify / flag / community / placeholder) with bulk actions |
| `/admin/feedback` | User feedback inbox |

All admin pages re-verify `fn_is_platform_admin()` server-side. The audit log is append-only — even admins can't tamper through the API.

---

## PWA / offline status (as built)

**Service worker** (`public/sw.js`, CACHE_VERSION = `cruz-golf-v1`):

- Static assets (`/_next/static/`, logos, fonts, css, js): **cache-first**.
- HTML pages: **network-first, cache fallback**. Last-resort offline fallback: cached `/dashboard` or an HTML stub.
- `/api/*` and `/auth/*`: pass-through (never cached).
- Auto-claims clients on activate; cleans up old cache versions on version bump.

**Score writes** (`lib/useScoreSaver.ts` + `lib/score-queue.ts`):

- localStorage outbox queue, durable across browser closes.
- Drains on online / focus / SIGNED_IN / TOKEN_REFRESHED events.
- `retry()` with exponential backoff on each item.
- `beforeunload` warning if pending writes exist.
- Failed items don't block the head — queue walks forward; user gets Retry / Diagnose / Discard via `<SaveStatusBanner>`.

**Offline indicators / chrome**:

- `<OfflineIndicator>` — calm amber pill at top when `navigator.onLine === false`. Statement, not exclamation.
- `<UpdateToast>` — bottom-left toast when a newer deploy is detected (via `useVersionWatch`). User picks when to refresh.
- All floating chrome (`<ActiveRoundPill>`, `<HelpButton>`, `<InstallPrompt>`, `<UpdateToast>`) uses `bottom-[calc(... + env(safe-area-inset-bottom, 0px))]` so the iPhone home indicator never overlaps.
- Loading skeletons at `app/(app)/loading.tsx`, `dashboard/loading.tsx`, `rounds/[id]/loading.tsx` cover slow-network RSC streaming.

**Press accept offline:** NOT queued. User sees "You're offline. Try again when you reconnect." (see `lib/press-errors.ts` + Q7 in Open strategic questions).

---

## QA status (current as of a9a2723)

- **Test suite: 312/312 passing across 22 files.** Run `npm test -- --run`.
- **Typecheck: clean.** Run `npx tsc --noEmit`.
- **Engine + settlement coverage:** 22 unit tests for press, 19 scenario simulations, 13 real-round (8-player) integration tests. All zero-sum invariants hold.
- **Press lifecycle:** every state transition (open / accept / decline / withdraw / expired) tested; status filter at settlement verified; finalize-with-pending-press warning verified.
- **PWA reliability:** safe-area / floating chrome / skeleton loaders verified at code level. **Real-device iPhone QA still pending — checklist in `docs/IPHONE_PWA_QA.md`.**
- **Admin support:** dispute workflow walkthrough in `docs/ADMIN_PRESS_DISPUTE_WORKFLOW.md`. Not exercised with a real dispute yet.

---

## Course library status (current as of 0038)

NE FL priority list — **7 of 13 populated + verified:**

✅ JGCC (preset + verified template) · ✅ PVIC Ocean · ✅ PVIC Lagoon · ✅ TPC Sawgrass Stadium · ✅ Deerwood CC · ✅ Timuquana CC · ✅ The Plantation at Ponte Vedra Beach

**Still placeholder, waiting on official scorecards** (no fabrication):
⏳ Sawgrass CC · ⏳ Atlantic Beach CC · ⏳ Marsh Landing · ⏳ TPC Dye's Valley · ⏳ San Jose · ⏳ Pablo Creek

Plus the Berkeley Hall South Course (Bluffton SC) template (0033, awaiting apply).

When a scorecard arrives:
1. Verify rating + slope are printed for each tee.
2. Follow the `0034` / `0038` pattern: idempotent migration, `do $...$` block, one tee per color, men's-only, status=verified if data is complete (else `needs_review`).
3. Paste SQL in chat for Patrick to apply via Supabase SQL editor.
4. Mark applied in `ISSUE_TRACKER.md` migration table.

---

## Testing convention

Pure functions + regression tests. The pattern:

1. Engine logic lives in `lib/*.ts` with no React, no Supabase, no env coupling
2. Test in isolation via vitest
3. Thin presentational components (`components/*.tsx`) consume the pure functions
4. Server components in `app/(app)/*.tsx` do the data shaping; everything else is testable

When adding a new clubhouse signal / game variant / course-page filter — pure builder + tests first, UI wiring after.

Run tests: `npx vitest run`. Run typecheck: `npx tsc --noEmit`. Both must be green before commit.

---

## Things to NEVER do

- Fabricate course rating/slope/stroke-index data
- Scrape club websites, USGA, or Bluegolf
- Add midnight auto-finalize / auto-close cron jobs
- Hard-delete user data without an audit log entry
- Commit fake GHIN integration or pretend GHIN data is verified when it isn't
- Re-introduce duplicate UI (separate Gross / Net game entries, multiple finalize CTAs, etc.)
- Use cartoon emoji on streaks / records / milestones (the data is the interest)
- Bypass RLS via service-role for routine reads — service-role is only for admin diagnostics + cross-group operations
- Modify shared/production resources via Browser MCP without explicit per-action authorization
- Push to main when typecheck or vitest is red

---

## Things to ALWAYS do

- Soft-delete via `deleted_at` columns; never hard-delete user data through the UI
- Write audit-log entries on lifecycle changes (the table + `fn_log_destructive` shipped in 0027/0029)
- Treat the round lifecycle as `draft → live → pending_finalization → finalized` (no skipping pending)
- Use `<RoundBreadcrumb>` on every round sub-page
- Use `<PhotoPicker>` (camera + library both) on every upload surface — not `capture="environment"`
- Wrap handicaps in `HandicapValue` envelopes via `wrapManualIndex` — no bare numbers downstream
- Surface clubhouse signals **only when meaningful** (min thresholds: streak 2+, rivalry run 3+, course mastery 3+ rounds, lifetime 60+ days, milestone 14-day window)
- Cap visible cards on the ClubhouseStrip at 4 — restraint matters
- Keep migrations non-destructive + idempotent + additive

---

## Common gotchas (you will hit these)

1. **POSTGRES_URL not in Vercel env.** Can't apply DDL programmatically. Paste SQL in chat → Patrick runs in Supabase. Don't try to work around this.
2. **Browser MCP blocked from production DDL.** Even with the Claude Chrome extension, applying DDL via the dashboard crosses a "modify shared resources" threshold and gets denied. Same workflow: paste SQL.
3. **RLS recursion.** Don't write policies that `select from platform_admins` — use `fn_is_platform_admin()` (SECURITY DEFINER, bypasses RLS). This was a P0 incident; fixed in migration 0022.
4. **Sentinel "Cruz Golf · Course Library" group.** Owns all `is_template=true` courses. Don't accidentally surface it as a user's group on `/dashboard`.
5. **JGCC quick-add still exists** as a per-group preset (`lib/presets/jgcc.ts`) AND now also as a verified template. Either path produces the same data; the template is preferred for new groups.
6. **`fn_clone_course` rejects placeholders.** Placeholder courses (no tees yet) refuse to clone server-side — users see a clear error. The library card UI also hides the Clone button for placeholders.
7. **Score writes are NOT RLS-gated by status.** Only the `score-group` page's app-level redirect blocks scoring on `finalized`. Pending falls through → editable. This is by design; don't add an RLS check that breaks it.
8. **Settlements are stored per `round_player_id`**, not per player. When computing per-player money in clubhouse signals, walk `from_round_player_id` / `to_round_player_id` and resolve to `player_id` via the `round_players` table.
9. **The `audit_log` is append-only by RLS.** No UPDATE / DELETE policies — even an admin can't tamper through the normal API. Service-role still can if absolutely needed.
10. **Test runner needs project-root cwd.** `npx vitest run` from `/c/Users/patri` will scan the wrong tree. Always `cd /c/Users/patri/Documents/golf-games-app` first.

---

## Commit hygiene

- Co-author every Cruz Golf commit with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` only when explicitly authorized — Patrick prefers commits attributed to him.
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(...)`, `refactor(...)`, `docs(...)`.
- Body explains the **why**, not the **what**. Why this change, why now, what the alternatives were and why we didn't pick them.
- Reference migration numbers when relevant.
- Always note the test count (`Tests: NNN/NNN passing`) and typecheck status in the commit body.

---

## When the user is frustrated

Patrick gets frustrated when I:
- Stop after small updates and ask permission instead of continuing
- Ignore an explicit "knock everything out" directive
- Re-litigate decisions that are already in `ISSUE_TRACKER.md` or this file
- Add cartoon-y / engagement-bait copy to anything
- Defer real engine work as "needs another session" repeatedly without scope justification

When in doubt about whether to ship: **ship**. Auto mode is usually on. Ask only for: destructive ops on shared data, payments, ToS, privacy/security, or genuinely-architectural pivots.

---

## Privacy model (per Patrick, 2026-05-10 — decided)

The starting privacy model unless a major technical reason forces otherwise:

- **Everything defaults to group-private.** Group members see group leaderboards / records / settlements / clubhouse signals.
- **Public links are explicit, read-only shares.** Spectator tokens (existing `rounds.spectator_token`), record-book share tokens (TBD).
- **No global public social feed.** No discovery surface, no algorithmic timeline, no strangers in your data.
- **No cross-group leaderboards by default.** A user who joins multiple groups sees each group's data, but groups don't bleed into each other's surfaces.
- **Strangers only enter via explicit join/share.** A user accepting a group invite is the only path. Nobody appears on your records or rivalries unless they're a member of a group you're in.

Friends-list scope (Q3): treat as **global per profile**, but every "share to friend" is an explicit one-time share — never an implicit data leak across groups.

## Manual press model — AS BUILT (shipped 2026-05-10, migrations 0035 + 0036)

Manual presses are fully shipped. This section is the as-built reference — if you change behavior here, update the docs + tests + this section.

**Schema** (`round_presses` table from migration 0035):

| Column | Notes |
|---|---|
| `id` | UUID, primary key |
| `round_id` | FK to `rounds(id)` |
| `game_id` | optional FK to `round_games(id)` — null for round-level presses |
| `segment_label` | display string, e.g. "Nassau back · manual press" |
| `start_hole` / `end_hole` | inclusive range; must cover ≥3 holes; clamped to `round.holes` |
| `stake_cents` | positive integer |
| `side_a_rp_ids` / `side_b_rp_ids` | `uuid[]`, frozen at open. Both sides must cover EVERY player in the round (0036 partition check) |
| `status` | one of `pending` / `accepted` / `declined` / `withdrawn` / `expired` |
| `opened_by_rp_id` / `opened_at` | always set |
| `accepted_by_rp_id` / `accepted_at` | set on accept |
| `declined_by_rp_id` / `declined_at` | set on decline |
| `withdrawn_at` | set on withdraw |
| `expires_at` | default opened_at + 24h |

**RPCs** (`fn_open_press`, `fn_accept_press`, `fn_decline_press`, `fn_withdraw_press`):

- SECURITY DEFINER. Authenticated only.
- `accept`/`decline`/`withdraw` use `SELECT ... FOR UPDATE` row locks (0036 race fix).
- Open validates: caller is on side A, partition covers all players, hole range fits `round.holes`, ≥3 holes, stake > 0.
- Every state change writes a `destructive_audit_log` row via `fn_log_destructive` (kinds: `press.open`, `press.accept`, `press.decline`, `press.withdraw`).

**Engine** (`lib/games/press.ts`):

- `settleManualPress(press, holes)` — pure function. Returns `PressMatch` with `result_delta = null` if any in-range hole is incomplete.
- `pressPotsBySide(presses, sideA, sideB)` — zero-sum money distribution. Loser pays stake, pot splits among winners, remainder cent to first sorted winner id.

**UI** (`app/(app)/rounds/[id]/press-controls.tsx`):

- "+ Press" affordance on every live or pending-finalization round.
- "Press requested" amber banner for side-B players (or commissioner) with Accept / Decline.
- "Press pending" card for the opener with Withdraw.
- Accepted strip with calm green dot.
- Hides pending presses opened >24h ago (UI-side expiry).
- All three RPCs wrapped in `retry` helper (3 attempts, 400ms backoff) via `lib/press-errors.ts` translator.

**Realtime** (subscribed in both PressControls AND ActiveRoundPill):

- `postgres_changes` on `round_presses` filtered by `round_id`.
- Any state change → `router.refresh()` on the round page, or refetch press-pending count on the pill.
- 60s safety-net refresh covers silent socket drops.

**Active round pill** alert state:

- Green "Live · [course] →" when round is just live.
- **Amber "Press pending · [course] →"** when the viewer is on side B of a pending press.
- Visible on every non-round page (hides on /dashboard which has its own hero card, /rounds/[id] which IS the destination, /demo, /admin).

**Finalize integration** (`app/(app)/rounds/[id]/finalize/`):

- Only `status === "accepted"` presses settle.
- Best-ball gross-min per side computes the per-hole HoleResult[].
- **Pending-press warning banner** at top of finalize view when any pending press exists in the 24h window — blocks silent drops.
- Per-press line in "By game" breakdown labeled `"<segment> · manual press"`.

**Admin observability**:

- `/admin` overview lists all pending presses across the platform (amber >12h, red >20h).
- `/admin/rounds/[id]` shows the full lifecycle: status pill, sides, opener, acceptor/decliner/withdrawer, timestamps, raw UUID.
- `/admin/audit?kind=press.open` filters the destructive-op log; each row deep-links back to the round.

**Tests:**

- `tests/press.test.ts` — 22 unit tests (detection + settlement)
- `tests/press-simulation.test.ts` — 19 scenario tests (status filter, overlap, 2v2, 1v3, 6-6-6 frozen sides, incomplete blocking, mixed status)
- `tests/real-round-simulation.test.ts` — 13 end-to-end tests (8-player JGCC round)
- `tests/press-errors.test.ts` — 8 translator tests

---

## Open strategic questions

| # | Question | Status |
|---|---|---|
| Q1 | Add `POSTGRES_URL` to Vercel via Supabase integration? | Patrick said "worth doing soon" — would unblock autonomous DDL apply. Not yet done. |
| Q2 | Public record-book share — opt-in per round or per record-book? | Defer until friends-list ships |
| Q3 | Friends list — global or per-group scope? | **Decided 2026-05-10: global per profile, explicit one-time shares only.** Not yet built. |
| Q4 | Cross-group "club leaderboards" — opt-in per round or default-participate? | **Decided 2026-05-10: no cross-group leaderboards by default.** |
| Q5 | When a guest is linked to a real account, do their past rounds count toward personal stats? | Almost certainly yes — not implemented |
| Q6 | Push notifications for press requests? | Not implemented. Active round pill amber alert is the only out-of-app signal. Re-evaluate after real-world use. |
| Q7 | Should press accept queue offline like score writes? | **Decided 2026-05-10: NO.** 24h expiry window + business rules make queueing risky. Retry+offline message is the right semantic. |

Don't re-ask these without reason. If a feature requires a decision on one, surface it with a recommendation.
