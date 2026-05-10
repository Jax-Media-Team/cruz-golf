# Cruz Golf — Claude Code project context

**Read this before doing any work in this repo.** It's the load-bearing context that turns a cold session productive in 30 seconds. The detailed roadmap lives in `ISSUE_TRACKER.md`; this file is the *posture* — voice, principles, decisions already made, things to never re-litigate.

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

## Manual press UI — design questions for next session

Patrick (2026-05-10) flagged manual presses as the most important remaining betting feature, and asked me to think through the parameters. Here's the design surface to lock down before building:

| Question | Recommended answer |
|---|---|
| **Who can press?** | Either side's commissioner, OR any active player on the round. Default: any player on a side that's currently down. Both sides must acknowledge. |
| **When is a press available?** | At any hole the down-side has played but no later than 3 holes from the segment end (matches the auto-press 3-hole rule). Disabled before scores exist. |
| **What hole does the press start on?** | The NEXT hole after the trigger event. Press doesn't retroactively cover already-played holes. |
| **Acknowledgement model?** | One-tap accept by the OTHER side. Mid-round wager-ack pattern, similar to existing `round_wager_acks`. Auto-expires after 24 hours if not accepted. |
| **Stake?** | Defaults to parent segment's stake. Commissioner can override to a different stake. |
| **Live leaderboard display?** | Shows "Press 1 open · holes 7-18 · Patrick + Ben press" inline with the segment summary. Per-press deltas accumulate into the per-player total. |
| **Settlement display?** | Per-press line items in the FinalizeView's "By game" breakdown — same pattern as auto-presses already use (`label: "Nassau front · press 1"`). |
| **Audit log?** | Every press open + accept + decline writes a `destructive_audit_log` row (kind: `press.open` / `press.accept` / `press.decline`). Provides recovery path if disputes arise. |
| **Reversibility?** | Until accepted, the opener can withdraw. Once accepted, it's binding through finalize unless commissioner unfinalizes the round. |

Ship plan when picking this up:
1. New table `round_presses` (round_id, segment_label, opened_by_rp, opened_at, accepted_by_rps[], accepted_at, withdrawn_at, stake_cents, start_hole, status)
2. RPCs: `fn_open_press`, `fn_accept_press`, `fn_decline_press`, `fn_withdraw_press`
3. UI: small "Press →" affordance on the round page when commissioner-applicable + a "press accepted" banner for the opposing side
4. Engine wiring: `lib/games/press.ts` extended to accept manual presses alongside auto-presses; settlement reads `round_presses` rows and applies them

Defer until Patrick green-lights the design.

---

## Open strategic questions

| # | Question | Status |
|---|---|---|
| Q1 | Add `POSTGRES_URL` to Vercel via Supabase integration? | Patrick said "worth doing soon" — would unblock autonomous DDL apply. Not yet done. |
| Q2 | Public record-book share — opt-in per round or per record-book? | Defer until friends-list ships |
| Q3 | Friends list — global or per-group scope? | **Decided 2026-05-10: global per profile, explicit one-time shares only.** |
| Q4 | Cross-group "club leaderboards" — opt-in per round or default-participate? | **Decided 2026-05-10: no cross-group leaderboards by default.** |
| Q5 | When a guest is linked to a real account, do their past rounds count toward personal stats? | Almost certainly yes |

Don't re-ask these without reason. If a feature requires a decision on one, surface it with a recommendation.
