# Cruz Golf — Running Issue Tracker

Single source of truth for everything Patrick has asked for, grouped by area.
Items get checked off as they ship; design notes stay until they become tickets.

Last updated by the agent on the most recent QA pass. **If something here is
wrong or stale, it gets fixed in the same commit that fixes the bug.**

---

## Bugs

| # | Item | Status |
|---|------|--------|
| BUG-1 | "Couldn't save 1 score." on score input | ✅ shipped — useScoreSaver hook + localStorage queue |
| BUG-2 | Sign-out → blank page | ✅ shipped — `app/auth/signout/route.ts` returns 303 |
| BUG-3 | Score input screen jumping around | ✅ shipped — uncontrolled inputs + onBlur saves |
| BUG-4 | Email confirmation rate limit (Supabase 2/hr) | ✅ shipped — Confirm Email disabled + clearer signup copy |
| BUG-5 | Settlement breakdown lied about $17.50 | ✅ verified — math agent confirmed engine math sound |
| BUG-6 | Login redirect lost ?next= | ✅ shipped — middleware injects x-pathname |
| BUG-7 | Scorecard import memory leak (object URL) | ✅ shipped — try/finally with revokeObjectURL |
| BUG-8 | Scorecard OCR race when adding photo mid-OCR | ✅ shipped — busy guard + queue snapshot |
| BUG-9 | Last hole CTA was unclickable label | ✅ shipped — onFinish prop → "View leaderboard →" |
| BUG-10 | Skins "Pot per skin" copy confusing | ✅ shipped — "Each skin (USD)" + helper |
| BUG-11 | Gross/Net asked too early in game picker | ✅ shipped — family-first picker + Mode toggle |
| BUG-12 | Delete round: "Linked record is missing" | ✅ shipped — fn_delete_round v2 (0021) + clearer error + archive fallback |
| BUG-13 | Live pill blocked tap on dashboard cards | ✅ shipped — pill hidden on /dashboard, smaller, dismissible |
| BUG-14 | Players ⋯ menu hidden under sibling cards (mobile) | ✅ shipped — z-50 menu + parent `relative z-40` when open |
| BUG-15 | Players search placeholder mentions GHIN/phone | ✅ shipped — "Search players…" |
| BUG-16 | New round date field overflows on iOS | ✅ shipped — globals.css iOS `<input type="date">` reset |
| BUG-17 | Times displayed in UTC (future for Eastern users) | ✅ shipped — `lib/format-date.ts` + admin pages updated |
| BUG-18 | More menu felt empty | ✅ shipped — bigger emoji, scrollable sheet, sign-out as card |
| BUG-19 | Help text said "AI is not configured" | ✅ shipped — softer wording, points to FAQ + feedback |
| BUG-20 | Stale "Live" pill after deleting active round | ✅ shipped — layout query filters `deleted_at` |

## UX polish

| # | Item | Status |
|---|------|--------|
| UX-1 | Mobile bottom nav showing Records/Leaderboards/Admin | ✅ shipped — 5-up grid + More sheet |
| UX-2 | Dashboard quick-links + active-round hero | ✅ shipped |
| UX-3 | Round page: prominent Enter scores hero + Edit games tile | ✅ shipped |
| UX-4 | Players tab: search + ⋯ overflow menu | ✅ shipped |
| UX-5 | Courses page: 📷 Import scorecard primary CTA | ✅ shipped |
| UX-6 | "Each skin" + Pot-based default for Skins | ✅ shipped |
| UX-7 | Family-first game picker | ✅ shipped |
| UX-8 | Floating "Live" pill | ✅ shipped — refined |
| UX-9 | Breadcrumbs on deeper pages | ✅ shipped — Breadcrumbs component |
| UX-10 | One-step finalize copy + Unfinalize button | ✅ shipped |
| UX-11 | ShareSheet replaces "Open share image" | ✅ shipped |
| UX-12 | PIN / Open-to-group clarity in round header | ✅ shipped |
| UX-13 | Save Quick Start preset button (top + bottom of games section) | ✅ shipped |
| UX-14 | Logo +50% on mobile and desktop | ✅ shipped |
| UX-15 | Auto-finalize banner when all scores in | ✅ shipped |
| UX-16 | Wager handshake banners removed | ✅ shipped |
| UX-17 | Quick Start packages simplified (one per family) | ✅ shipped |
| UX-18 | Number inputs allow blank (defaultValue + onBlur) | partial — main offenders fixed; remaining cells already nullable |
| UX-19 | Score-pad sticky footer above mobile nav | ✅ shipped |
| UX-20 | Block score entry on finalized rounds | ✅ shipped |
| UX-21 | Demo round walkthrough polish | open — currently 8 steps; could add scorecard-import step |
| UX-22 | First-time user demo data with their name | open — designed, not built |

## Scoring & betting

| # | Item | Status |
|---|------|--------|
| BET-1 | Engine zero-sum invariant under stress | ✅ verified — 1000 random rounds × 5 invariants pass |
| BET-2 | Allowance % applied across families | ✅ shipped — applyAllowance helper |
| BET-3 | Skins: pot-based vs fixed-value | ✅ shipped |
| BET-4 | Skins: ties carry / split / nullify, advanced section | ✅ shipped |
| BET-5 | Nassau: front/back/overall + presses | ✅ shipped |
| BET-6 | Press options for non-Nassau (Best Ball, 6-6-6) | open — engine work, ~3-4h |
| BET-7 | Settlement breakdown shows per-game deltas | ✅ shipped — finalize-view |
| BET-8 | minimum-flow netting for fewest Venmo transfers | ✅ shipped |

## Admin

| # | Item | Status |
|---|------|--------|
| ADM-1 | Platform Admin role + nav surface | ✅ shipped |
| ADM-2 | Owner-email seed (idempotent) | ✅ shipped — fn_seed_owner_admins (0018) |
| ADM-3 | /admin/users with pagination | ✅ shipped |
| ADM-4 | /admin/groups, /admin/rounds, /admin/courses, /admin/feedback | ✅ shipped |
| ADM-5 | Admin can view stats for every account | open — see STATS-7 |
| ADM-6 | Course audit (incomplete data detection) | ✅ shipped — /admin/course-audit |

## Stats / records

| # | Item | Status |
|---|------|--------|
| STATS-1 | Leaderboards: 8 boards across all finalized rounds | ✅ shipped |
| STATS-2 | Record book: low gross 18 + high gross 18 + biggest win/loss + most rounds | ✅ shipped |
| STATS-3 | Record book: 9-hole low + season net + course records | ✅ shipped |
| STATS-4 | Personal stats page (averages, hole-by-hole) | partial — `/players/[id]/stats` exists; needs deeper averages by course/tee, partner stats, hot streak |
| STATS-5 | Birdies / pars / bogeys / doubles per round | open |
| STATS-6 | Average winnings + total winnings per player | partial — Money + Money/round on Leaderboards |
| STATS-7 | Admin access to per-user stats | open |

## Course data

| # | Item | Status |
|---|------|--------|
| COURSE-1 | Manual course entry (par/SI/yardage) | ✅ shipped — /courses/new |
| COURSE-2 | JGCC quick-add preset | ✅ shipped |
| COURSE-3 | Quick Import row paste | ✅ shipped |
| COURSE-4 | Scorecard photo OCR (multi-photo, editable review, validation) | ✅ shipped — /courses/import |
| COURSE-5 | JGCC stroke index correction (official) | ✅ shipped |
| COURSE-6 | Group-shared courses (RLS) | ✅ verified — `courses in my group` policy |
| COURSE-7 | Cross-group templates (Course library) | ✅ shipped — 0020 + clone-into-my-group UI |
| COURSE-8 | Compliant public course-data sources | research-only — best near-term path is community templates |
| COURSE-9 | Photo OCR conservativeness (null on uncertainty) | ✅ verified |

## Sharing / social / privacy

| # | Item | Status |
|---|------|--------|
| SHARE-1 | Spectator link per round | ✅ shipped — round.spectator_token |
| SHARE-2 | ShareSheet (native share, copy link, download/open image) | ✅ shipped |
| SHARE-3 | Per-group leaderboards/records (no strangers) | ✅ verified — RLS scopes by group |
| SHARE-4 | Friends / favorites list | open — design not started |
| SHARE-5 | Public read-only record book link | open — needs share_links table + token |
| SHARE-6 | Private invite-only sharing | open — same infra as SHARE-5 |
| SHARE-7 | Multi-user round access (invitees + open-to-group) | ✅ verified — works today |

## Sample / onboarding

| # | Item | Status |
|---|------|--------|
| ONB-1 | Sample round on first sign-in (uses new user's name) | open — designed, not built |
| ONB-2 | Demo tour at /demo | ✅ shipped — 8 steps |
| ONB-3 | Onboarding finisher when bootstrap incomplete | ✅ shipped — /onboarding |

## Mobile / PWA

| # | Item | Status |
|---|------|--------|
| MOB-1 | Mobile bottom nav with safe-area | ✅ shipped |
| MOB-2 | Score-pad footer above bottom nav | ✅ shipped |
| MOB-3 | Players ⋯ menu z-index | ✅ shipped |
| MOB-4 | New round date field on iOS | ✅ shipped |
| MOB-5 | PWA install prompt + iOS "Add to Home Screen" guidance | open — manifest exists, prompt UI needed |
| MOB-6 | Standalone-mode polish (no browser chrome) | partial — already PWA-installable; UI tweaks pending |

## Reliability / data

| # | Item | Status |
|---|------|--------|
| REL-1 | Score persistence: localStorage queue + retry + auth-state listener | ✅ shipped |
| REL-2 | Round delete: atomic fn_delete_round RPC | ✅ shipped — 0019, hardened in 0021 |
| REL-3 | Round archive (soft delete) fallback | ✅ shipped — 0021 |
| REL-4 | Finalize error checking (3 explicit error checks) | ✅ shipped |
| REL-5 | 1000-round property simulation tests | ✅ shipped |
| REL-6 | Auto-finalize regression tests | ✅ shipped |

---

## Recently shipped migrations (in prod)

| # | Date | What |
|---|------|------|
| 0017 | earlier | default_tee per player |
| 0018 | applied | fn_seed_owner_admins |
| 0019 | applied | fn_delete_round (atomic) |
| 0020 | open | course templates + fn_clone_course extension — **NEEDS APPLY** |
| 0021 | applied | rounds.deleted_at + fn_archive_round + fn_restore_round + fn_delete_round v2 |

---

## Roadmap (next 2-3 sessions)

1. **Apply 0020** to enable the Course Library / Templates feature
2. **Personal stats expansion** (STATS-4, STATS-5, STATS-7)
3. **Sample round for new users** (ONB-1)
4. **PWA install prompt** (MOB-5)
5. **Public record-book share links** (SHARE-5, SHARE-6) — needs share_links table
6. **Friends/favorites list** (SHARE-4) — needs friends table + UI
7. **Press options outside Nassau** (BET-6) — engine work
