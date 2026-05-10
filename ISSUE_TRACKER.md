# Cruz Golf — Running Issue Tracker

Single source of truth for everything Patrick has asked, answered, or is
waiting on. Updated continuously. **If something here is stale, it gets
fixed in the same commit that fixes the bug.**

---

## ✅ Answered questions (with answers)

### How does course visibility work across a group?

Courses are scoped by `group_id` via Postgres RLS:
- **Every member of a group** sees every alive course in that group (via the
  `"courses in my group"` policy that uses `fn_my_group_ids()`).
- **Templates** (`is_template = true`) are visible to every authenticated user
  across all groups (via the new `"courses templates readable"` policy).
- **Cloned courses** become normal group courses, fully editable inside the
  cloning group, independent from the source.

### Do invited users see existing group courses?

**Yes.** The moment they accept an invite and become a member of your group
(`group_members` row with role `commissioner` or `player`), they see every
alive course in that group's library. No re-add needed.

### Can other users add courses for the group?

**Yes** — any commissioner of the group can add courses. Today every member
sees every course; only commissioners write. The RLS policy
`"courses in my group" with check (group_id in fn_my_group_ids())` is
permissive for any group member to write, but the UI gates the Add Course
buttons to commissioners only.

### How will public/community course templates work?

Already shipped (migration 0020):
- Platform admin flags a course as `is_template = true`
- Any authenticated user sees it in `/courses` under "Course library"
- One-click `🔗 Clone into my group →` button creates a fresh copy in the
  user's group via `fn_clone_course`. The clone is a normal (non-template)
  course owned by the cloning group; they can edit it freely from there

### How do guest players get linked to real accounts?

Three paths after migration 0023 lands:
1. **Auto-suggest in /players UI** — for every guest player whose email
   matches a registered user, the Players page shows an inline
   "🔗 Link to account" card. One click links them.
2. **Commissioner-driven** — commissioner can link any guest in their
   group via the same UI.
3. **User self-claim (future)** — a user signing up with an email matching
   a guest player can be prompted to claim that profile. Not yet built;
   needs a one-time "Claim your spot" prompt at signup.

In all three: the link operation
- **preserves** the guest's player_id (and all `round_players` /
  `scores` / `settlements` referencing it stay intact)
- **archives** any duplicate player auto-created by the signup bootstrap
- **flips** `is_guest = false` and **backfills** the email
- **never** deletes data

### Does entering phone or email send an invite?

**No.** Today, neither field triggers any messaging — Cruz Golf has no
email or SMS provider configured. Both are stored locally for:
- **Email**: auto-link guest player to their account when they sign up
- **Phone**: just for your reference

If you want to invite someone to a round, use the explicit "Invite" path
on the round page, not the player form.

### Where do personal stats live?

`/players/[id]/stats` — every player has a stats page accessible from the
Players list. It shows: rounds, avg gross/18, avg net/18, scoring
distribution, best/worst round, by-course breakdown, season net.

The Records page also has a "Personal" scope at `/records/me` for record-
book style bests (lowest gross, biggest win, etc.) for the signed-in user.

### Where can Platform Admin view user stats?

Two paths:
1. `/admin/users` — list of every account with round counts + last sign-in
2. `/admin/users/[id]` — per-user detail with their group membership +
   admin role + linked players

The per-player stats page (`/players/[id]/stats`) works for any player you
have group access to via RLS. Platform admins can view any player by URL
(RLS bypass via service role isn't needed for stats — the stats page reads
finalized rounds from the player's group, which the admin's `fn_my_group_ids`
includes via membership).

### What is still missing from record books?

Currently shipped: lowest gross 18, highest gross 18, lowest gross 9,
biggest win, biggest loss, most rounds played, most birdies in a round,
season net, best gross by course, three scopes (Group / Personal / Course).

Open / requested:
- **Public read-only record-book share link** (no signup required to view)
- **Friends/favorites filter** so Patrick can share his record book with
  named people only
- **Per-tee breakdown** within a course (e.g. "best from Black tees")
- **Hole-by-hole averages** per player per course
- **Course/year championships** (best round per year per course)

### What is still missing from leaderboards?

Currently shipped: 8 boards (Money, Money/round, Win rate, Birdies, Hot,
Cold, Best round, Most active), all scoped to the user's group.

Open / requested:
- **Per-course leaderboards** (we've shipped per-course Records but not
  ongoing-season leaderboards)
- **Per-game-type leaderboards** (best skins player, best Nassau player)
- **Friends-only leaderboards** (same dependency as friends list)

### What is still missing from sharing / public links?

Currently shipped: spectator link per round (read-only token), ShareSheet
component (Web Share / Copy link / Download image / Open image), per-round
PNG share image at `/api/share/round/[id]/image`.

Open / requested:
- **Public record-book share** (private token + public read-only page)
- **Friends list** with private invites
- **"Save to phone gallery"** button on round results
- **Auto-post / one-tap social share** — currently goes through OS share
  sheet which works but isn't branded

### What still needs manual Supabase migration approval?

`0023_link_guest_player.sql` (queued, awaiting your "yes apply 0023")

`0024_course_archive.sql` (queued in this commit, awaiting "yes apply 0024")

Both are non-destructive — they create functions and update permissions,
no data deletion.

---

## ❓ Open questions waiting on your decision

| # | Question | Why I need an answer |
|---|----------|----------------------|
| Q1 | Should we add `POSTGRES_URL` to Vercel via the Supabase integration? | Without it, every migration requires you to paste SQL manually. With it, I can apply DDL via `/api/apply-XXXX` autonomously. ~2 minutes for you, unblocks future incidents. |
| Q2 | Public record-book share — should it be opt-in per round, or per record-book? | Two-layer permissions are cleaner; one-layer is simpler. |
| Q3 | Friends list scope — global friends or per-group? | If global: invite friend once, share record-book everywhere. If per-group: each group has its own friend list. |
| Q4 | Cross-group "club leaderboards" (e.g. "best score at JGCC by anyone") — should we ship with explicit opt-in per round, or default to participate-and-opt-out? | Privacy default question. |
| Q5 | When a guest is linked to a real account, should past rounds attributed to the guest count toward the user's personal stats? | Almost certainly yes, but worth confirming since it changes their record book retroactively. |

---

## 🐞 Bugs found (since last tracker update)

| # | Bug | Status |
|---|-----|--------|
| BUG-21 | RLS infinite recursion on platform_admins (caused course-add errors) | ✅ fixed via 0022 |
| BUG-22 | Quick Add JGCC created duplicate when course already existed | ✅ fixed (Quick Add tile becomes "Already added → Open JGCC" when course present) |
| BUG-23 | Desktop course card 404 on click | ✅ likely fixed via `prefetch={false}` + better not-found fallback |
| BUG-24 | "Finish steps above" no-op button | ✅ now disabled span with explanatory tooltip |
| BUG-25 | Admin link too dim on desktop nav | ✅ now a gold pill with 🛡 emoji |
| BUG-26 | "Linked record is missing" on round delete | ✅ fixed via 0019 + 0021 + frontend RPC switch |
| BUG-27 | Score-pad biased gross input by stroke count | ✅ fixed (always defaults to par) |
| BUG-28 | Scoring "+1" stroke marker confusing | ✅ replaced with yellow dots + tooltip |
| BUG-29 | Leaderboards page had a dead `Promise.all` query | ✅ fixed |
| BUG-30 | Course page hard-redirected on missing course (looked like 404) | ✅ now shows friendly "course gone or no access" state |

## 🐞 Bugs fixed (cumulative since project start)

See `git log` for the full record. Major historical fixes still in effect:
score-saver localStorage queue, sign-out blank page, scorecard-import OCR
race + memory leak, finalize 9-hole bug, scores UPDATE WITH CHECK, admin
users pagination, JGCC stroke index correction, etc.

## 🎨 UX polish remaining

- **Logo +25%** ✅ shipped (180→225 desktop, 108→135 mobile)
- **Course archive UI** ✅ shipped (Archive / Restore button on detail page; archived list at /courses?archived=1)
- **Leaderboards visibility on desktop** — already in top nav as "Leaderboards" + dashboard quick-link as "📊 Leaderboards". If still hard to find, may need to compress other nav items
- **Player stats button** — should now route correctly post-0022. Need a real-world re-test
- **Pin signed-in user to top of Players list** — sort logic exists; depends on player.profile_id matching auth.uid(). Will resolve once 0023 lands and Patrick links any unlinked guest representing himself
- **Demo pacing** ✅ bumped to 13s/scene
- **Demo scoring scene CTAs** ✅ +/- buttons made decorative; bottom Next is the only active CTA
- **/demo end CTA** ✅ "Get started — sign up free →"
- **Add player form clarity** ✅ required/optional labels + helper text on email/phone
- **Press options for non-Nassau games** — open
- **Friends list UI** — open
- **Public record-book share** — open

## 🗺 Roadmap items (next 2-3 sessions)

1. **Friends list + private record-book share** (one feature, two views)
2. **Public record-book share-link** with token-based read-only access
3. **Per-game-type leaderboards** (best skins / Nassau / etc.)
4. **Press options for Best Ball / 6-6-6** (engine work)
5. **Auto-link new signups to matching guest players** (cron-style + signup-flow trigger)
6. **Cross-group "club leaderboards"** (opt-in)

## 🚧 Blocked items

- Auto-apply migrations from `/api/apply-XXXX` — blocked on adding `POSTGRES_URL` to Vercel (Q1 above)
- Email/SMS invites for new players — blocked on choosing a provider (Resend / Postmark / Twilio etc.)

## ✅ Completed items (this session)

- 0022 RLS recursion fix applied + verified
- Diagnostic + cleanup of all incident endpoints
- 6 UX items from your refinement pass: admin pill, finish-steps, demo pacing, add-player form, etc.
- Course duplicate prevention (Quick Add detects existing JGCC)
- Course archive/restore RPCs (0024) + UI
- Logo +25%
- Three record-book scopes (Group / Personal / Course)
- Three guest-link RPCs (0023)
- Player Stats refactor + best/worst rounds + by-course breakdown

---

## Migrations status

| # | Status | What |
|---|--------|------|
| 0017–0021 | applied | default_tee, admin_seed, delete_round_rpc, course_templates, archive_round |
| 0022 | applied (you applied today) | RLS recursion fix |
| 0023 | **awaiting your apply** | Guest-to-account linking RPCs |
| 0024 | **awaiting your apply** (in this commit) | Course archive/restore + JGCC dedupe RPCs |
