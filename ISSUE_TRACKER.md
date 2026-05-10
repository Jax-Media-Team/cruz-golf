# Cruz Golf — Living Roadmap & Issue Tracker

**Product north star** (per Patrick, 2026-05-10):

> **The operating system for private golf groups.**
>
> Persistent group identity, history, gambling, smack talk, rivalries.
> Not a GHIN replacement — a place where Saturday foursomes, golf trips,
> and club groups live for years. The emotionally sticky parts are the
> all-time records, the partner history, the recurring rivalries, the
> trip archives — not the scorecard itself.

Course data + handicap workflows still need work, but **scorecard OCR +
shared course library + community templates** is the right near-term
path. Direct USGA/GHIN integration is reserved for later if licensing
becomes possible.

This file is the source of truth — updated continuously, organized by
priority bucket per Patrick's framing.

---

## 🚨 Critical bugs

| # | Item | Status |
|---|------|--------|
| 0022-RECURSION | RLS infinite recursion on `platform_admins` blocked all course writes | ✅ fixed (migration 0022 applied) |
| QUICK-ADD-DUPE | Quick Add JGCC created duplicates when course already existed | ✅ Quick Add tile now becomes "Already added → Open JGCC"; `fn_dedupe_jgcc_in_group` cleans existing dupes (in 0024) |
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
| 0023 | **awaiting your apply** | guest-to-account linking RPCs |
| 0024 | **awaiting your apply** | course archive + JGCC dedupe RPCs |

---

## Current session execution log

(Cleared each session; lives here so the running narrative stays
near the next-up work.)

- 0022 applied, recursion gone, write smoke-test passed
- Patrick's JGCC course intact (5 tees, 90 holes); duplicate appeared after he clicked Quick Add (the recursion was making `hasJgcc` false because the courses query was failing)
- Quick Add tile now detects existing JGCC and routes to "Already added → Open"
- Course detail page has Archive/Restore button (commissioner-only, gated on 0024)
- `prefetch={false}` on course Links to dodge stale Next.js prefetches
- Logo +25%
- Issue tracker rewritten with this categorical structure
- Two migrations queued: 0023 (guest linking) + 0024 (course archive + dedupe)
