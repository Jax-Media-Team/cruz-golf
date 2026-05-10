# Cruz Golf — Living Roadmap & Issue Tracker

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

---

## 🚨 Critical bugs

| # | Item | Status |
|---|------|--------|
| 0022-RECURSION | RLS infinite recursion on `platform_admins` blocked all course writes | ✅ fixed (migration 0022 applied) |
| QUICK-ADD-DUPE | Quick Add JGCC created duplicates when course already existed | ✅ `fn_dedupe_jgcc_in_group` cleans existing dupes (0024 applied); smart dedupe ran for Patrick's group |
| DUAL-JGCC-RENDER | Two JGCC entries showed on /courses (hero "Already added" tile + same row in YOUR COURSES) | ✅ killed the dual render; three labeled sections; dedup logic in `lib/courses-page.ts` with 18 regression tests (commit 4eb3549) |
| DUPLICATE-FINALIZE-CTA | Three Finalize entry points on /rounds/[id] (header button + green banner + secondary tile) | ✅ header is round-meta only; banner and tile mutually exclusive (commit 9ec3ade) |
| FAKE-IMPERSONATION | "View as User →" on /admin/rounds/[id] silently bounced to dashboard (RLS blocked admin from seeing other groups' rounds) and was a confused affordance — Patrick wanted observability, not impersonation | ✅ replaced with "👀 Spectate live →" using existing token-keyed read-only leaderboard + AdminSpectatorBanner; admin-mode flag re-verified server-side via `fn_is_platform_admin()` so it can't be spoofed |
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
| AUDIT-LOG-DESTRUCTIVE | Trace destructive ops (delete round, archive player) | ⏳ open — needs new audit table |

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
| RIVALRIES | Head-to-head career W/L between any two players | ⏳ open |
| PARTNER-CHEMISTRY | "Together you're +$420; apart you're +$200" | ⏳ open |

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
| RIVALRY-CARD-IMAGE | "Patrick vs Jeff: 14W-12L lifetime" PNG | ⏳ open |
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

---

## 🎯 Next major focus areas (per Patrick, 2026-05-10)

In rough priority order. Each gets its own QA sweep + regression tests.

1. **Onboarding flow** — first 60 seconds should be obvious; smart
   defaults; progressive disclosure
2. **Current-round navigation clarity** — at any moment, "what do I do
   next" should be a single tap from anywhere
3. **Player linking / claiming** — guest → real account flow needs to
   be one tap, undoable, with visible audit trail
4. **Personal stats pages** — depth without configurability creep
5. **Record books** — already shipped; deepen with partner / rivalry /
   lifetime aggregations
6. **Social sharing** — round share, record share, rivalry cards
7. **Public/private sharing models** — cleanly modeled, not a settings
   maze
8. **Friend/group relationships** — Q3 still open; pick a model and
   ship it
9. **Course library UX** — discovery, cloning, attribution, dedup
10. **Installable / PWA app feel** — manifest + service worker +
    offline score entry queue (already partial via score-queue.ts)

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
