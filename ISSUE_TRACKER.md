# Cruz Golf — Living Roadmap & Issue Tracker

## Next session priorities (per Patrick, 2026-05-10)

1. **Data integrity + trust** — no destructive ops without explicit approval; archive/restore default
2. **Manual press UI** — design spec is in `CLAUDE.md` under "Manual press UI — design questions"; ready to build once green-lit
3. **Installed-PWA / offline polish** — service worker + score-entry offline queue (already partial via `lib/score-queue.ts`)
4. **Continue product QA** — regression tests + mobile sweeps + admin/non-admin checks + simulated rounds (the loop is working)
5. **Course data accuracy** — never fabricate; placeholder/community/verified states must stay honest
6. **Privacy model — decided 2026-05-10:** group-private default, no cross-group leaderboards, no public social feed (see CLAUDE.md)
7. **Keep CLAUDE.md + this file current** — source of truth for cold sessions

---

## Latest session highlights (2026-05-10 overnight, commits c82b32a → 77f5cf8)

What shipped while you were away:

- **Match-play + auto-presses for Best Ball + Aggregate** (engine + UI). Nassau got real presses earlier; this turn extended the same primitive to team games. New `match_play: true` config flips them to hole-by-hole settlement; `presses: 'auto_2_down'` fires when a team is 2 down with 3+ holes left. 9 new regression tests including zero-sum invariant and 3+ team fall-back.
- **Career money + Last-round signals** in the clubhouse engine. Surfaced in `<ClubhouseStrip>` with restraint thresholds (career money: ≥ 5 rounds AND ≥ $30 netted; last-round: only the freshest finalized round).
- **/admin/course-library bulk actions.** Multi-select + sticky action bar with Verify / Flag / Community / Placeholder / Untemplate per bucket. Parallel RPC dispatch via `Promise.allSettled`; per-row errors surface inline.
- **Rivalry share image** at `/api/share/rivalry/image?a=…&b=…` — 1200×630 OG PNG. New `<RivalryShareButton>` on per-rivalry rows in `/players/[id]/stats`, surfaced only when `rounds_together ≥ 3`.
- **QA agent findings — all 4 fixed:** P0 `ClubhouseRound` type missing `pending_finalization`, P1 admin /rounds Pending filter chip, P2 status pill amber styling across 4 admin pages (centralized via `statusPillFor()`), P2 admin user-detail bucketing (pending now in "Active rounds" instead of "Other rounds played").

**Tests:** 239/239 passing. **Typecheck:** clean. **Migrations:** all applied through 0031.

---

**Product north star** (per Patrick, 2026-05-10):

> **The operating system for private golf groups.**
>
> Persistent group identity, history, gambling, smack talk, rivalries.
> Not a GHIN replacement — a place where Saturday foursomes, golf trips,
> and club groups live for years. The emotionally sticky parts are the
> all-time records, the partner history, the recurring rivalries, the
> trip archives — not the scorecard itself.

**What we are NOT trying to be:** launch monitor app, shot-tracing
analytics, GPS-heavy, ultra-technical stat golf, GHIN replacement.

Course data + handicap workflows still need work, but **scorecard OCR +
shared course library + community templates** is the right near-term
path. Direct USGA/GHIN integration is reserved for later if licensing
becomes possible.

This file is the source of truth — updated continuously, organized by
priority bucket per Patrick's framing.

---

## 📐 Course-data ingestion rule (per Patrick, 2026-05-10)

**One tee per color, men's rating + men's stroke index only.**

When seeding course templates from a scorecard:
- Black / Gold / Blue / White / Green / Red / etc. → one row each, named by the bare color
- Use the **men's** rating + slope (the most-played number for member-member groups)
- Use the **men's** stroke index
- **Skip** "Ladies'" tee duplicates, combo tees (Blue/White / White/Green), and any speciality tees that just remix existing colors
- Skip the per-tee gender split — gender lives on individual players via their handicap, not on the tee row

Rationale: cleaner picker, less noise on /rounds/new, and the rating math the engine cares about (course handicap = HI × slope/113) lands the same for 99% of group play. Players who genuinely play from a different tee than they're set up for can still pick any tee at round time.

If a real need surfaces for ladies' ratings (e.g., a specific group plays mixed gender from the same tee with separate ratings), we'll re-add via a per-player override rather than per-tee duplication.

---

## 🧭 Operating principles

These guide every decision. When in doubt, re-read.

1. **No duplicate UI.** If two things conceptually represent the same
   object/action, show one. Audit for: duplicate CTAs, duplicate
   course/player/round representations, multiple finalize flows,
   overlapping navigation paths, redundant setup choices.
2. **Opinionated over configurable.** Smart defaults beat 12 toggles.
   Progressive disclosure for advanced options. Especially: games,
   skins, presses, sharing, onboarding.
3. **Deterministic rendering.** A given DB state must always produce
   the same UI. Render rules belong in pure helpers with regression
   tests, not inline filters.
4. **Data integrity > velocity.** Soft-delete by default. No
   destructive ops without an audit trail and a recovery path. Golf
   betting/history apps cannot feel fragile.
5. **Continuous QA.** Every meaningful change gets:
   regression test → desktop+mobile sweep → admin/non-admin sweep →
   simulated round → persistence/reload check. Don't wait for Patrick
   to find bugs.
6. **Stop when it's destructive, payments, ToS, privacy/security, or a
   major architecture change.** Otherwise: ship.
7. **No dead ends.** Every screen has a primary next action.
   Empty states preview what's coming and offer a CTA, never just
   "nothing here yet". The user should never think "what now?"
8. **"Join the group", not "configure software".** Onboarding and
   copy lean crew/group/social, not enterprise/setup-heavy. Group-
   first language ("your crew", "your group", "your weekend") beats
   generic software wording. Long-term emotional goal: "Our golf
   group lives here," not "We use this scorekeeping app."
9. **The app should feel alive.** Surface live rounds, recent
   results, hot streaks, rivalries, activity. Spectator/admin
   surfaces double as social-proof surfaces — same token-keyed
   read-only path serves friends watching friends, members watching
   member-member tournaments, and admins debugging.
10. **Watching ≠ editing ≠ acting as admin ≠ acting as user.**
    These four modes must be visually unmistakable. Banners,
    colors, and routes should never let those states blur.
11. **Shared history is the moat.** Once a group has been using the
    app for months, the rivalry counts, lifetime totals, partner
    records, and trip archives are what makes it irreplaceable.
    "Our golf history lives here" beats every feature checklist.
    Every signal we surface should feel earned, data-supported,
    naturally discoverable — never artificially manufactured.
12. **Tone discipline.** Statements not exclamations. No badges,
    no fire emoji on streaks, no fantasy-sports vibes, no casino
    psychology. Member-member gambling group, golf-trip group
    chat, private clubhouse — that's the voice. The data is the
    interest, not the chrome.

---

## 🔄 Round lifecycle (ships with 0025)

Patrick (2026-05-10): "I do NOT think rounds should auto-finalize/close
at midnight. That creates too many trust and reliability risks."

State machine:
  draft → live → pending_finalization → finalized
                          ↑
                          └─── still editable; commissioner can resume

| Stage | Editable? | Settlements? | Visible where |
|-------|-----------|--------------|---------------|
| draft | yes | no | Drafts bucket on /dashboard |
| live | yes | no | "Live now" bucket on /dashboard, ActiveRoundPill, Clubhouse strip |
| pending_finalization | YES (still editable) | no | "Awaiting finalization" bucket on /dashboard, NOT in live signals |
| finalized | no (unfinalize first) | yes | "Recently finalized" bucket on /dashboard |

Transitions:
  - live → pending: `fn_mark_round_pending(round_id)` — commissioner-only
  - pending → live: `fn_resume_round(round_id)` — commissioner-only
  - any → finalized: existing finalize flow
  - finalized → live: existing UnfinalizeButton

NO time-driven auto-transitions ship with this migration. Optional
opt-in heuristics (no edits for X hrs + all scored + no unresolved
wagers) are queued in the engine-work table.

## 🚨 Critical bugs

| # | Item | Status |
|---|------|--------|
| 0022-RECURSION | RLS infinite recursion on `platform_admins` blocked all course writes | ✅ fixed (migration 0022 applied) |
| QUICK-ADD-DUPE | Quick Add JGCC created duplicates when course already existed | ✅ `fn_dedupe_jgcc_in_group` cleans existing dupes (0024 applied); smart dedupe ran for Patrick's group |
| DUAL-JGCC-RENDER | Two JGCC entries showed on /courses (hero "Already added" tile + same row in YOUR COURSES) | ✅ killed the dual render; three labeled sections; dedup logic in `lib/courses-page.ts` with 18 regression tests (commit 4eb3549) |
| DUPLICATE-FINALIZE-CTA | Three Finalize entry points on /rounds/[id] (header button + green banner + secondary tile) | ✅ header is round-meta only; banner and tile mutually exclusive (commit 9ec3ade) |
| FAKE-IMPERSONATION | "View as User →" on /admin/rounds/[id] silently bounced to dashboard (RLS blocked admin from seeing other groups' rounds) and was a confused affordance — Patrick wanted observability, not impersonation | ✅ replaced with "👀 Spectate live →" using existing token-keyed read-only leaderboard + AdminSpectatorBanner; admin-mode flag re-verified server-side via `fn_is_platform_admin()` so it can't be spoofed |
| DEAD-END-EMPTY-STATES | Leaderboards / records / records/me / ledger / records/me-unlinked all had empty states with no primary CTA — pure dead ends | ✅ rewritten with previews of what's coming + group-first language + Start a round / Set up your group / Claim your name CTAs |
| ONBOARDING-TONE | Dashboard checklist read like enterprise setup ("Get started", "Add a course", "Add your players") | ✅ tone shift to "Set up your group" / "Pick your home course" / "Add your crew" / "Tee it up" with crew-flavored body copy |
| HEADER-WASTED-SPACE | Header was `min-h-[140px] sm:min-h-[200px]` with oversized icons, leaving visible breathing space above/below the lockup | ✅ tightened to `py-2 sm:py-3` with 72/120px icons; ~40px reclaimed mobile, ~80px desktop. Brand mark stays prominent. |
| PWA-SAFE-AREA | Bottom nav buttons too close to iPhone home indicator; status bar overlapped header in installed PWA | ✅ `pb-[env(safe-area-inset-bottom)]` on nav + `pt-[env(safe-area-inset-top)]` on header + body padding scales with safe area |
| SPECTATOR-CONFUSING-COPY | "That tab is only available inside the round dashboard for invitees" sounded broken | ✅ rewritten as intentional "Spectator view · gross + net only · Skins, teams, and wagers stay inside the group" |
| ALLOWANCE-WORDING | "Allowance %" was unclear to non-WHS golfers | ✅ renamed to "Hcp Allowance %" everywhere user-facing + helper text "% of full handicap players get. 100 = full strokes, 85 = standard match-play scaling." |
| CLUBHOUSE-TONE-DOWN | Initial ClubhouseStrip read too gamified ("🔥 Patrick on a 3-round heater") | ✅ rewritten as understated stat lines ("Patrick has won 3 rounds in a row · $15 taken across the streak"), no fire emoji, statements not exclamations |
| PHOTO-UPLOAD-CAMERA-ONLY | Every photo-upload surface used `<input capture="environment">` which forces the camera and silently denies users their saved screenshots, AirDropped scorecards, and texted images | ✅ shipped `<PhotoPicker>` in `components/PhotoPicker.tsx` with explicit "📸 Take photo" + "🖼 Choose from library" buttons; wired into scorecard-import + round upload flows. iOS / Android / desktop all show the right OS sheet. |
| DESKTOP-COURSE-404 | Course cards 404'd on desktop click (worked on mobile) | ✅ added `prefetch={false}` + friendly not-found page |
| ROUND-DELETE-FK | "Linked record is missing" on round delete | ✅ fixed in 0019 + 0021 + frontend RPC switch |
| FINISH-STEPS-NOOP | Get Started "Finish steps above" button did nothing | ✅ now disabled span with tooltip |
| ADMIN-INVISIBLE | Admin link too dim on desktop | ✅ now gold pill with 🛡 emoji |
| STROKE-INDICATOR | Score-pad biased gross input by stroke count + confusing "+1" | ✅ fixed |
| LEADERBOARDS-DEAD-QUERY | Empty `Promise.all` branch in /leaderboards | ✅ fixed |

## 🎨 UX polish

| # | Item | Status |
|---|------|--------|
| LOGO-SIZE | Logo +25% on top of previous +50% (180→225 desktop, 108→135 mobile) | ✅ |
| COURSE-ARCHIVE-UI | Archive/Restore button on course detail; archived list at /courses?archived=1 | ✅ shipped (needs 0024) |
| ADD-PLAYER-CLARITY | Required vs optional labels; helper text on email/phone | ✅ |
| DEMO-PACING | Auto-advance 7.5s → 13s; scoring-scene buttons made decorative | ✅ |
| DEMO-END-CTA | "Create your group" → "Get started — sign up free" | ✅ |
| INSTALL-PROMPT-IOS | iOS Safari guidance with Share-icon glyph + "open in Safari" path for non-Safari iOS browsers | ✅ |
| PIN-LOGGED-IN-USER | Pin signed-in user to top of Players list | ✅ logic exists; needs profile_id on the row (resolves once 0023 lands + Patrick links any unlinked guest of himself) |
| DESKTOP-LEADERBOARDS | Leaderboards visible on desktop top-nav | ✅ already there; needs your re-test post-deploy. If still hidden, nav may be overflowing — I'll compress |
| PLAYER-STATS-LINK | Stats button refreshes page | ✅ symptom of RLS recursion; resolved by 0022 |
| NUMBER-INPUT-FIGHT | Number inputs cursor-fight when typing | ✅ converted to defaultValue + onBlur for worst offenders |
| MORE-MENU-EMPTY | Mobile More sheet looked sparse | ✅ scrollable + sign-out as card |
| ACTIVE-ROUND-PILL | Floating "Live · [Course]" pill in the way | ✅ hidden on /dashboard, dismissible per round |

## 🏌️ Core product (round + scoring + games + settle)

| # | Item | Status |
|---|------|--------|
| GAME-FAMILY-PICKER | Family-first game picker with Mode toggle | ✅ shipped |
| SKINS-POT-VS-FIXED | Pot-based default + Advanced collapse | ✅ shipped |
| AUTO-FINALIZE-PROMPT | "All scores entered. Review and finalize?" banner | ✅ shipped |
| UNFINALIZE-BUTTON | Commissioner can unlock a finalized round | ✅ shipped |
| FINALIZED-SCORE-GUARD | Block score entry on finalized rounds | ✅ shipped |
| LAST-HOLE-CTA | Score-pad on hole 18 routes to leaderboard | ✅ shipped |
| GROUP-SCORE-ENTRY | Multi-player scoresheet (Golf Genius style) | ✅ shipped |
| IN-ROUND-GAME-EDITOR | Commissioner edits games / stakes mid-round | ✅ shipped |
| 1000-ROUND-TESTS | Property-based simulation: zero-sum, min-flow drains to zero | ✅ shipped (5 invariants × 200 random rounds) |
| PRESS-OPTIONS-NON-NASSAU | Best Ball, 6-6-6 should support presses too | ⏳ open — engine work, ~3-4h |
| SHOTGUN-START-AWARENESS | Auto-finalize math handles shotgun starts | ✅ counts entries, not "did they reach 18" |
| AUDIT-LOG-DESTRUCTIVE | Trace destructive ops (delete round, archive player) | ✅ shipped — 0027 adds `destructive_audit_log` table, `fn_log_destructive` helper, augments archive/restore/pending/resume/verify/template-flag RPCs to write audit rows. Append-only via RLS, admin-read-only. /admin overview shows last 8 entries. |

## 🧑‍🤝‍🧑 Social / group features (the differentiator)

This is the bucket that separates Cruz Golf from "another scorecard app."
**Persistent group identity** is the long-term moat.

| # | Item | Status |
|---|------|--------|
| GROUP-RECORD-BOOK | Group-scoped records (lowest gross, biggest win, etc.) | ✅ shipped |
| PERSONAL-RECORD-BOOK | /records/me with personal best, by-course breakdown | ✅ shipped |
| COURSE-RECORD-BOOK | /records/course/[id] per-course records (group-scoped) | ✅ shipped |
| GUEST-ACCOUNT-LINKING | "🔗 Link to account" suggestion when guest email matches | ✅ shipped (needs 0023) |
| ALL-TIME-MONEY-LIST | Cumulative net across every group round | partial — Season net top 5 on Records; need a dedicated /records/money page |
| BIGGEST-CHOKE | Biggest single-hole or single-game collapse | ⏳ open |
| PARTNER-RECORDS | "Best record with X as partner" | ⏳ open — needs partner aggregation |
| LIFETIME-NASSAU | Career Nassau wins/losses per player | ⏳ open |
| BEST-SCRAMBLE-PARTNER | Lifetime scramble partner W/L | ⏳ open |
| HOT-COLD-STREAK | Already shipped on Leaderboards (Hot/Cold boards) | ✅ shipped |
| RYDER-CUP-HISTORY | Multi-round trip / event scorecards | ⏳ open — needs trip/event concept |
| GOLF-TRIP-ARCHIVES | Group trips spanning multiple courses + days | ⏳ open |
| SANDBAGGER-WATCH | Players whose net wins suggest a soft handicap | ⏳ open — needs anomaly detection |
| AI-RECAP-SMACK-TALK | Already partially shipped (SmackTalk component on finalize) | ✅ partial — generates moments at finalize |
| RIVALRIES | Head-to-head career W/L between any two players | ✅ shipped — `buildRivalrySignals` surfaces both active streak runs ("Luis 4-in-a-row over Patrick") and long-running matchups ("Patrick vs Jeff: 14-12 all-time"). On dashboard ClubhouseStrip when min 3 rounds together. |
| PARTNER-CHEMISTRY | "Together you're +$420; apart you're +$200" | ✅ shipped — `buildPartnerSignals` aggregates W-L-P across rounds where two players shared a team_id. Surfaces most-paired duo with their record + combined cents. Min 2 paired rounds. |
| GROUP-LIFETIME | "Sunday Crew has moved $18,420 lifetime · together 4 years" | ✅ shipped — `buildGroupLifetimeSignal` totals every finalized round + cents moved + days-since-first-round. Only renders when meaningfully long (60+ days OR 8+ rounds) so it doesn't read as filler in new groups. |
| COURSE-MASTERY | "Mitch owns hole 4 at JGCC", "Kyle still hasn't won a Nassau at Pablo Creek" | ⏳ open — needs per-hole and per-game-type aggregation; care needed so it doesn't tip into fantasy-sports tone |
| MILESTONES | "Tom finally broke 80", "Biggest skins pot your group has played" | ⏳ open — first-time / record-setting detection. Must be idempotent so it doesn't re-fire on every page-load. |

## 📊 Stats / records (depth + accessibility)

| # | Item | Status |
|---|------|--------|
| LEADERBOARDS-8-BOARDS | Money / Win-rate / Birdies / Hot / Cold / Best round / Most active / Money-per-round | ✅ shipped |
| RECORD-BOOK-3-SCOPES | Group / Personal / Course | ✅ shipped |
| PER-PLAYER-STATS | /players/[id]/stats with rounds, avg gross/net, scoring distribution, best/worst, by-course | ✅ shipped |
| PLATFORM-ADMIN-USER-STATS | Per-account view in /admin/users/[id] | ✅ partial — has profile + linked players + admin status; could deepen with their stats |
| HOLE-BY-HOLE-AVG-PER-COURSE | Average score on hole 1 / hole 2 / etc. at JGCC | ⏳ open |
| PER-TEE-BREAKDOWN | Best score from Black tees vs Gold tees | ⏳ open |
| PER-GAME-LEADERBOARDS | Best skins player, best Nassau player | ⏳ open |
| FRIENDS-ONLY-LEADERBOARDS | Filter leaderboards to a named subset | ⏳ open — depends on Friends list |

## 🛡 Admin observability / spectator (NEW bucket)

Patrick's framing (2026-05-10): admin power should be **observability, not
impersonation**. Spectator surfaces are also product surfaces — they
double as the foundation for friends watching friends, member-member
tournaments, Ryder Cup weekends, and trip leaderboards. Same token-keyed
read-only path; the admin banner is the only difference.

| # | Item | Status |
|---|------|--------|
| ADMIN-SPECTATOR-BANNER | Sticky `🛡 Platform Admin · read-only spectator` banner on any leaderboard reached via `?adminMode=1` | ✅ shipped — `components/AdminSpectatorBanner.tsx`, server-verifies admin status |
| ADMIN-SPECTATE-FROM-ROUND | Replace "View as user →" with "👀 Spectate live →" on /admin/rounds/[id] | ✅ shipped |
| ADMIN-SPECTATE-FROM-LIST | Inline 👀 Spectate column on /admin/rounds for live rounds | ✅ shipped |
| ADMIN-SPECTATE-FROM-USER | "Active rounds" section on /admin/users/[id] with Spectate + Inspect buttons | ✅ shipped |
| ADMIN-SPECTATE-FROM-GROUP | Inline Spectate for live rounds on /admin/groups/[id] | ✅ shipped |
| ADMIN-LIVE-RIGHT-NOW | "🟢 Live right now" strip on /admin overview with one-tap spectate per round | ✅ shipped |
| ADMIN-EDIT-MODE | Explicit opt-in admin-mutate mode (separate route, distinct banner color, audit-logged) for the rare case admin needs to fix data | ⏳ open — design needed before any mutate-as-admin path is added |
| FRIEND-SPECTATOR | Same token-keyed surface, but discoverable from a friends list | ⏳ open — depends on Friends list (FRIENDS-LIST below) |
| TRIP-SPECTATOR | Multi-round trip view with rolling leaderboard | ⏳ open — depends on GOLF-TRIP-ARCHIVES |
| MEMBER-MEMBER-SPECTATE | Bracket view of a tournament with live status across foursomes | ⏳ open — depends on RYDER-CUP-HISTORY |

## 🔗 Sharing / virality

| # | Item | Status |
|---|------|--------|
| SPECTATOR-LINK | Public read-only token per round | ✅ shipped |
| SHARE-SHEET | Web Share API + copy link + download image + open image | ✅ shipped |
| ROUND-SHARE-IMAGE | PNG of final standings via /api/share/round/[id]/image | ✅ shipped |
| PUBLIC-RECORD-BOOK-LINK | Token-protected read-only record book viewable without signup | ⏳ open — needs `share_links` table |
| FRIENDS-LIST | Per-user friends list for private record-book / leaderboard sharing | ⏳ open — biggest sharing feature gap |
| AUTO-POST-SOCIAL | One-tap social share to FB / IG / X | ⏳ partial — Web Share API works; could add branded targets |
| RIVALRY-CARD-IMAGE | "Patrick vs Jeff: 14W-12L lifetime" PNG | ✅ shipped — `/api/share/rivalry/image?a=&b=` route renders 1200×630 OG card via next/og. `<RivalryShareButton>` on player stats rivalry rows opens the existing ShareSheet. Surfaced only when rounds_together ≥ 3. Tone discipline held. |
| GROUP-INVITE-LINK | "Join my Cruz Golf group" public invite | ⏳ open — currently only round-level invites |
| EMAIL-SMS-INVITES | Send actual emails / texts to invitees | 🚫 blocked — needs Resend/Postmark/Twilio choice + budget |

## 🛠 Infrastructure

| # | Item | Status |
|---|------|--------|
| AUTONOMOUS-DDL | Add `POSTGRES_URL` to Vercel via Supabase integration → I can apply migrations server-side | 🚫 blocked on Patrick (Q1) |
| MIGRATION-PIPELINE | Today: paste SQL into Supabase. Future: `npm run db:push` from CI | ⏳ depends on AUTONOMOUS-DDL |
| AUDIT-LOG-TABLE | `destructive_audit_log` table tracking who deleted/archived what | ⏳ open |
| SOFT-DELETE-EVERYWHERE | Players + courses + rounds all have `deleted_at` | ✅ shipped (0021 + 0024) |
| SUPABASE-BACKUP-POLICY | Confirm point-in-time-restore is enabled on the project | ⏳ Patrick to verify in Supabase dashboard |
| PROD-OBSERVABILITY | Vercel logs work; would benefit from Sentry / Posthog | ⏳ open |
| RATE-LIMIT-OCR | OpenAI API hits could be abused; needs per-user quota | ⏳ open |
| TEST-COVERAGE | 142/142 tests pass; engine has 1000-round property tests; UI has very little | ⏳ open — Playwright suite is the gap |

## 🪪 Handicap providers (architecture for future GHIN integration)

Patrick (2026-05-10): "GHIN integration is probably the single biggest
infrastructure/trust unlock for the app long-term... however I do NOT
want to build fragile or non-compliant scraping systems." Plan: Phase 1
ships the seam, Phase 2 lights up real GHIN once an official
partnership exists.

`lib/handicap-provider.ts` (shipped) defines:
  - `HandicapValue` envelope (index + provider + trust + fetched_at)
  - `HandicapProviderLookup` interface (id, label, trust, lookup())
  - `manualProvider` (default — wraps hand-entered numbers)
  - `ghinProvider` (placeholder — returns null until official integration)
  - `resolveEffectiveHandicap()` enforcing the **local-overrides-always-win**
    safety rule so an official refresh can't silently change a
    commissioner's negotiated handicap

Phase 2 schema (queued, NOT yet shipped):
  - `players.handicap_provider` (text, default 'manual')
  - `players.handicap_external_id` (GHIN number)
  - `players.handicap_official_index` (last fetched snapshot)
  - `players.handicap_official_fetched` (timestamptz)
  - `players.handicap_local_overrides` (boolean)

Existing `handicap_index` + `ghin_number` columns stay; new columns
layer in additively. RLS doesn't change.

Tone discipline carries: when GHIN data is shown, the badge reads
"Official" or "Hand-entered" — not "VERIFIED!!!" or trust-score icons.

Tests: 13 regression cases in `tests/handicap-provider.test.ts`
including the override-always-wins safety property.

---

## 🔮 Future / experimental

| # | Item | Why interesting |
|---|------|-----------------|
| GHIN/USGA-LICENSING | Direct integration if/when licensing becomes possible | Solves handicap-update friction; not on the immediate path |
| BLUEGOLF-IMPORT | Compliant import of public course data | Watch their TOS — currently blocks scraping |
| AI-COMMENTARY-PER-HOLE | "Patrick birdied 14 — first one since the spring scramble" | Deepens the smack talk angle |
| AI-WEEKLY-RECAP | Auto-generate Saturday recap and post to group chat | Recurring engagement loop |
| HANDICAP-PROJECTION | "After this round your index will be 12.4" | Educational; uses our stored scores |
| STROKE-PLAY-TROPHIES | Year-end "Saturday Champion" badge | Rewards the regulars |
| AI-PHOTO-RECAP | Take a photo at 18, AI captions it, posts to group | Pure social glue |
| TIP-JAR | Players can tip the commissioner who runs the group | Not monetization; gratitude |
| ALEXA-SCOREKEEPER | Voice score entry on the cart | Edge case but cool |

---

## ❓ Open questions waiting on Patrick

| # | Question | Why I need an answer |
|---|----------|----------------------|
| Q1 | Add `POSTGRES_URL` to Vercel via the Supabase integration? | Without it, every migration requires you to paste SQL manually. ~2 minutes for you, unblocks autonomous DDL apply going forward. **Recommended: yes.** |
| Q2 | Public record-book share — opt-in per round, or per record-book? | Two-layer permissions are cleaner; one-layer is simpler. |
| Q3 | Friends list scope — global or per-group? | Global = invite once, share everywhere. Per-group = each group has its own. |
| Q4 | Cross-group "club leaderboards" — opt-in per round, or default-participate-and-opt-out? | Privacy default question. Probably opt-in. |
| Q5 | When a guest is linked to a real account, should past rounds count toward their personal stats? | Almost certainly yes. Worth confirming. |

---

## ✅ Migrations status

| # | Status | What |
|---|--------|------|
| 0017 | applied | default_tee per player |
| 0018 | applied | fn_seed_owner_admins |
| 0019 | applied | fn_delete_round (atomic) |
| 0020 | applied | course templates + fn_clone_course extension |
| 0021 | applied | rounds.deleted_at + fn_archive_round + fn_restore_round + fn_delete_round v2 |
| 0022 | applied | RLS recursion fix (platform_admins / feedback / courses-templates-admin-write) |
| 0023 | applied | guest-to-account linking RPCs |
| 0024 | applied | course archive + JGCC dedupe RPCs |
| 0025 | **awaiting your apply** | round lifecycle: 'pending_finalization' status + fn_mark_round_pending + fn_resume_round. Verification checklist at `supabase/migrations/VERIFY_0025_0026.md` |
| 0026 | **awaiting your apply** | course library v2: verification_status + submitted_by + admin RPCs + 13 NE FL priority course shells (placeholder status) + JGCC template stub. Verification checklist at `supabase/migrations/VERIFY_0025_0026.md` |
| 0027 | applied | destructive_audit_log table + fn_log_destructive helper + augmented lifecycle RPCs (archive/restore round + course, mark/resume pending, verify, template flag) write audit rows. Append-only by RLS — no UPDATE/DELETE policies. Read access platform-admin-only. |
| 0028 | applied | JGCC template promotion: populates the placeholder template course with 5 tees + 90 holes from the JGCC preset and bumps verification_status to 'verified'. |
| 0029 | **awaiting your apply** | audit hooks for the remaining destructive RPCs: fn_delete_round, fn_dedupe_jgcc_in_group, fn_link_guest_to_profile, fn_unlink_player. Same pattern as 0027 — appends a `fn_log_destructive` call to each function. Re-creates each in full; safe to re-run. |
| 0030 | applied | Ponte Vedra Inn & Club Ocean (par 71) + Lagoon (par 70) populated from the official PVIC scorecard PDF. Both verified, fully cloneable. |
| 0031 | applied | Slim PVIC templates to one tee per color. Templates only — user clones unaffected. |
| 0032 | **awaiting your apply** | TPC Sawgrass Stadium (Blue tee, 76.8/155, verified) + Deerwood CC (4 tees, yardage/par/SI verified; rating/slope placeholder, status=needs_review). Idempotent. |

---

## 🎯 Next major focus areas (per Patrick, 2026-05-10)

In rough priority order. Each gets its own QA sweep + regression tests.

1. **Onboarding flow** — first 60 seconds should be obvious; smart
   defaults; progressive disclosure. Tone: "join the group", not
   "configure software"
   - ✅ Dashboard checklist tone refresh (Set up your group / Pick
     your home course / Add your crew / Tee it up)
   - ⏳ OnboardingTour copy refresh
   - ⏳ /onboarding finisher copy + flow review
   - ⏳ Welcome card after first signup
2. **Current-round navigation clarity** — at any moment, "what do I do
   next" should be a single tap from anywhere
   - ✅ Floating "Live · [course]" pill already shows on every
     non-/dashboard, non-/round, non-/admin page
   - ✅ /dashboard active-round hero card with one-tap to score-group
   - ✅ `<RoundBreadcrumb>` component shipped — persistent
     "← Course · date · status" header on /finalize, /score,
     /score-group, /invites, /wagers, /upload, /games (replaced
     generic Breadcrumbs for consistency)
   - ⏳ /join intentionally keeps its dashboard back-link (user isn't
     yet inside the round)
   - ⏳ "what to do next" affordance on each sub-page (e.g.
     /score-group last-hole "Done? → Finalize" already exists; audit
     the others)
3. **Reduce dead-ends / empty-state CTAs**
   - ✅ /leaderboards · /records · /records/me · /ledger empty
     states rewritten with previews + Start-a-round / Set-up-your-
     group / Claim-your-name CTAs
   - ⏳ /players empty state (already has CTA but could preview
     what links/stats unlock)
   - ⏳ /courses empty state (already has CTA — could be more
     group-flavored)
4. **Living-clubhouse activity on /dashboard** — group-centric only
   (NOT public/algorithmic feed). Patrick's framing: "private golf
   crew · 'our golf history lives here'", not "public golf influencer
   feed." Tone discipline: statements not exclamations, no badges,
   no fire emoji, no fantasy-sports vibe.
   - ✅ `<ClubhouseStrip>` shipped — live-round leader card,
     understated stat cards, no chrome/badges. `lib/clubhouse.ts`
     pure-function engine with regression tests.
   - ✅ Streaks: "Patrick has won 3 rounds in a row · $15 taken
     across the streak"
   - ✅ Rivalries (active streaks): "Luis has taken money off
     Patrick 4 rounds in a row · 7-3 all-time over 10 rounds"
   - ✅ Rivalries (long matchups): "Patrick vs Jeff · 14-12
     all-time · 26 rounds together"
   - ✅ Partner chemistry: "Patrick + Ben · 5-1 as partners · 6
     rounds together · $80 combined"
   - ✅ Group lifetime: "Sunday Crew · 47 rounds · $2,150 moved ·
     Together 4 years"
   - ✅ Course mastery (per-course leader): "Patrick averages 78.4
     at JGCC over 6 rounds · best of 73 · Mitch next at 79.2".
     `buildCourseMasterySignals` aggregates per-(course, player)
     average gross normalized to 18 holes; min 3 finalized rounds at
     the course; ignores partial rounds (<9 holes scored).
   - ✅ Milestones (recent first-time events): "Tom broke 80 for the
     first time — 78 at JGCC". `buildRecentMilestones` walks each
     player's chronological rounds and surfaces first-time events
     for broke_80 / broke_90 / broke_100 / personal_best / first_eagle
     within the last 14 days. Idempotent — same data → same milestones,
     no re-firing on page reload.
   - ⏳ Hole-mastery: "Mitch owns hole 4 at JGCC" (needs per-hole
     aggregation across rounds; data plumbing in place, just engine work)
   - ⏳ Game-type-specific: "Kyle hasn't won a Nassau at Pablo Creek"
     (needs game-type bucketing in settlements)
   - ⏳ Group-record milestones: "Biggest skins pot the group has
     played" (needs game settlement aggregation)
   - ⏳ Recent finalized "moments" (e.g. "Ben finally beat Kyle in
     skins") — overlaps with Course-mastery + Milestones
   - ⏳ Realtime live-position updates (currently snapshot at page
     load; could subscribe to scores realtime)
5. **Player linking / claiming** — guest → real account flow needs to
   be one tap, undoable, with visible audit trail
6. **Personal stats pages** — depth without configurability creep
7. **Record books** — already shipped; deepen with partner / rivalry /
   lifetime aggregations
8. **Social sharing** — round share, record share, rivalry cards
9. **Public/private sharing models** — cleanly modeled, not a settings
   maze
10. **Friend/group relationships** — Q3 still open; pick a model and
    ship it
11. **Course library UX** — discovery, cloning, attribution, dedup
12. **Installable / PWA app feel** — manifest + service worker +
    offline score entry queue (already partial via score-queue.ts)
    - ✅ iOS safe-area insets on top header + bottom nav (so status
      bar and home indicator never overlap chrome)
    - ⏳ Service worker / offline shell
    - ⏳ App-icon polish for iOS standalone
    - ⏳ Native-feeling page transitions
    - ⏳ Loading skeletons on slow networks

## 🛠 Engine work queued (bigger refactors)

| # | Item | Why it's not a quick fix |
|---|------|--------------------------|
| PRESS-ALL-GAMES | Make presses a first-class capability for Nassau, Best Ball, 6-6-6, team games, Ryder Cup formats — not Nassau-only | ✅ Nassau + Best Ball + Aggregate shipped. `lib/games/press.ts` is the shared primitive (13 regression tests). Best Ball + Aggregate also gained a `match_play: true` config option that flips them to hole-by-hole match settlement. When match_play+presses=auto_2_down, the press primitive fires identically to Nassau. ⏳ Scramble + 6-6-6 still on the legacy stroke-play path; same one-page wiring per game when needed. Manual presses (commissioner adds mid-round) still TBD. |
| GROSS-NET-MIXED | Replace separate "Gross Skins" + "Net Skins" entries with one "Skins" + a Gross/Net toggle inside setup | ✅ shipped — `/rounds/new` now uses the family-first picker (Individual / Best ball / Aggregate / Scramble / Skins / Nassau / 6-6-6 / Side bets), each with a Variant dropdown when applicable and a Gross/Net mode toggle when applicable. The in-round `/rounds/[id]/games` editor was already family-first; both surfaces now share the same `GAME_FAMILIES` catalog. State stays keyed by concrete `GameType` under the hood — settlement engine + simulation tests untouched (217/217 pass). |
| COURSE-LIBRARY-V2-DATA | The 13 NE FL priority courses are seeded as placeholders only (name/city/state). Real tee/rating/slope/hole data needs to come from publicly available scorecards, club PDFs, or community-submitted OCR | Compliant ingestion only. Per Patrick: no scraping, no TOS-risk, no fabricated rating/slope numbers. The infrastructure (verification_status, admin RPCs, OCR import pipeline) is shipped — fill happens via admin moderation as data lands. |
| COURSE-MULTI-TEE-EVOLUTION | Long-term, courses need: combo tees, gender-specific ratings, custom local rules, temporary reroutes, course revisions over time | Current model: course_tees + course_holes. Multi-tee combos and revision history would need a versioning layer or `effective_from` columns. Worth designing carefully before implementing. |
| ROUND-AUTO-PENDING | Optional opt-in heuristic to move rounds to pending: all holes scored AND no edits for X hrs AND no unresolved wagers, with commissioner override always available | Patrick explicitly DOES NOT want hard midnight closures. Any auto-rule must be conservative + reversible. Audit trail required. |

---

## Current session execution log

(Cleared each session; lives here so the running narrative stays
near the next-up work.)

- 0022 + 0023 + 0024 applied; RLS recursion fix shipped; smart-dedupe ran
  for Patrick (canonical JGCC restored, 3 empty dupes archived)
- Course detail page has Archive/Restore button (commissioner-only)
- `prefetch={false}` on course Links to dodge stale Next.js prefetches
- Issue tracker reorganized with operating principles + next focus areas
- DUAL-JGCC-RENDER fix shipped (commit 4eb3549): killed the duplicate
  hero tile, extracted dedup rules to `lib/courses-page.ts`, 18
  regression tests; full suite at 160/160
