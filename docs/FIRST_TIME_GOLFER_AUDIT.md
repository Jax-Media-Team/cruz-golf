# Cruz Golf — First-Time-User UX Audit

**Date:** 2026-05-12
**Persona:** Saturday morning JGCC member, 50, iPhone-only, eight regulars. Heard about Cruz Golf from a friend. Doesn't read help docs. Will quit silently if anything is confusing.

The lens: "Would 8 guys at JGCC on a Saturday actually trust and enjoy this?" Not "do tests pass."

This audit was commissioned by Patrick. Findings are sorted P0/P1/P2 at the bottom.

---

## 1. Landing page — `app/page.tsx`

**Works:** The h1 ("Your Saturday game, finally organized") nails the persona. The "Skins. Nassau. Best Ball. Settle up before you leave the parking lot." line is exactly what a 50-year-old member-member golfer wants to read. Tone is right: clubby, statement-driven, no fire emoji.

**Friction:**

- Three CTAs on the hero stacked side-by-side ("Create account", "See it in action", "I have an account") — `app/page.tsx:33-37`. A first-timer's eye bounces. "I have an account" doesn't apply to him; "See it in action" competes with "Create account" for primary attention. **Fix:** demote "I have an account" to a smaller text link under the buttons (the way Stripe / Linear do it). Keep Create + Demo as the two primary affordances.
- The bottom hero strip ("Walk me through it →", `app/page.tsx:77-90`) duplicates the "See it in action" button above. Per Principle 1 (no duplicate UI), one of them should go. **Fix:** delete the bottom strip OR delete the hero "See it in action" button. Keep one demo entry per scroll.
- "the modern operating system for private golf wagers" — `app/page.tsx:40`. *Wagers* will make some JGCC members wince. They play for money but they don't call themselves wagerers. **Fix:** "the modern operating system for private golf groups." (or just "for private golf — period.")
- "Scorecard upload — Photo a paper card" Feature (`app/page.tsx:71-74`) is mistitled as a primary feature. Most first-time visitors won't care until round 3. **Fix:** Move it below the fold or fold it into "Live scoring" with one line.

---

## 2. Auth flow — `app/login/page.tsx`, `app/signup/page.tsx`

**Works:** Signup copy is human ("Takes 30 seconds. You can name your crew when you start your first round."). The post-signup "Check your inbox" panel with 1-2-3 list (`app/signup/page.tsx:90-95`) is exemplary. The friendlyAuthError pattern is good.

**Friction:**

- "Email not confirmed" amber card on login (`app/login/page.tsx:122-141`) says **"Look for an email from Supabase"**. A JGCC member doesn't know what Supabase is. **P0** — this looks like phishing to a careful 50-year-old. **Fix:** "Look for an email from Cruz Golf (sender shows as noreply@cruz-golf.app or similar)." Don't expose the vendor name.
- Password "Minimum 8 characters" is shown *under* the field at 10px (`app/signup/page.tsx:163`). It's borderline-unreadable on an iPhone in sunlight, and golfers will type "golf123" and get a server error. **Fix:** bump to 12-13px and add live validation (green check at 8 chars). Bonus: drop the requirement to 6 or remove it — these guys won't be brute-forced.
- Login form is auto-focused on email (`autoFocus` line 115). On an iPhone PWA that pulls the keyboard up immediately and pushes the logo off-screen on small models (iPhone SE / mini). **Fix:** drop `autoFocus` on the login screen — every returning user already knows to tap Email.
- Google/Facebook OAuth buttons render *below* email/password (`app/login/page.tsx:150-151`, `app/signup/page.tsx:174-175`). Industry pattern is OAuth-above-email so returning users hit one button. JGCC member who signed up with Google last week scrolls past his own preferred option. **P1 fix:** swap order: SSO buttons → divider → email/password.
- Signup requires First name + Last name as two fields (`app/signup/page.tsx:131-155`). One "Full name" field is the standard; two fields adds 50% more taps with no real benefit (you reassemble them on line 20 anyway). **P2 fix:** single "Full name" field, split server-side if you really need it.

---

## 3. Onboarding — `app/(app)/onboarding/page.tsx` + `onboarding-form.tsx`

**Works:** Single field. "What should we call you?" is the right question. The "rivalries, partner records, course mastery, ledger totals" blurb sells the moat clearly. "Take me to the clubhouse →" is on-brand.

**Friction:** Clean. Move on.

---

## 4. Create round — `app/(app)/rounds/new/page.tsx`

This is the page that will lose people. It's 1,794 lines and the user-facing form has **six sections** stacked vertically: Basics, Players, Teams, Quick start, Games, Junk.

**Friction:**

- Section ordering is wrong for a beginner. **Quick start sits BETWEEN Teams and Games** (`page.tsx:830` after Teams at 822, before Games at 933). A first-timer scrolls Basics → Players → Teams (empty/confusing because no game is picked yet) → Quick Start (which solves the problem he didn't yet know he had). **P1 fix:** Order: Basics → **Quick start** (top, with Suggested packages as the obvious path) → Players → Games → Teams → Junk → Start round. Power users still scroll past; novices land on a one-tap "Saturday Skins + Nassau" preset.
- The Teams section appears unconditionally (`page.tsx:822-828`) even when no team game is enabled — `teamCount` defaults to 0 and the section shows "No teams (individual play)..." (`page.tsx:1753`). Cognitive load for nothing. **Fix:** hide the Teams section entirely unless a team game is enabled OR `teamCount > 0`.
- Drag-and-drop for team assignment (`page.tsx:1695-1707`). **P0 on mobile.** Drag-and-drop is unreliable on iPhone Safari, especially inside a scrolling page — Patrick's persona literally cannot put 8 players on 2 teams. There's a Random button, but if Random gives a lopsided pairing, the user is stuck. **Fix:** add a tap-to-assign button group per player ("Team 1" / "Team 2" / "—") as a fallback. Keep drag for desktop.
- Course-issues amber banner (`page.tsx:630-649`) renders inline with the form. A new user picks JGCC, sees "1 course data issue detected · net handicap math will be off until it's fixed", and now feels he can't trust the app. JGCC is one of the *verified* courses — if this banner ever fires on JGCC, it's a P0 bug. **Fix:** suppress the banner entirely for courses where `status='verified'`. The audit is for admins, not for golfers.
- Handicap-edit input has placeholder `"14.0 or +1.4"` (`page.tsx:705, 751`). A 50-year-old who doesn't know GHIN will see "+1.4" and wonder if that's something he's supposed to enter. **Fix:** placeholder `"14.0"`, move the "+plus index" hint into a `<details>`/info icon.
- Course Handicap is silently computed and never shown to the user before round-start. Member-member golfers WANT to verify their strokes-received before tee-off ("wait, I got 8 strokes? I usually get 11"). **P1 fix:** when a player is picked + a tee is chosen, show "CH: 11 · PH: 11" next to the HI input. This is a 1-line `courseHandicap()` call you're already doing on submit (line 521).
- "Add a guest player" block (`page.tsx:688-718`) requires HI for a guest. What if Dave-the-buddy-from-out-of-town doesn't know his handicap? **Fix:** make HI optional with helper text "Leave blank if unknown — they'll play as a scratch (0)." Don't block the round on this.

---

## 5. Add players — same page, `page.tsx:659-807`

**Works:** "Re-play with last round's lineup" button (`page.tsx:667-686`) is excellent for a recurring Saturday group. Logged-in-user sorted to top is right.

**Friction:**

- "New to this group" label for players with no past round (`page.tsx:735`) reads cold. **Fix:** "Not played yet" or "First round with the crew" — group-language matches the rest of the app.
- Player cards have a 2-column grid on mobile (`page.tsx:720`). With 8 players on a list, that's 4 rows of cards each requiring a check + expansion. On iPhone Pro it fits, on iPhone SE it's cramped. **Fix:** force single-column on `<sm` (it actually is grid-cols-1 already at small — but the `card p-3` padding makes them tall; reduce to `p-2.5`).

---

## 6. Choose games — `page.tsx:933-962` + `FamilyGameRow` (1049-1248)

**Works:** Family-grouped picker is the right abstraction. Quick-start presets are the escape hatch.

**Friction:**

- `GAME_FAMILIES` enumerated as 7+ rows of checkboxes. New user sees: Skins, Nassau, Best Ball, Aggregate, Scramble, 6-6-6, Wolf, Quota, Stableford, Match Play, Side Bets. **P1.** A JGCC member who's only played Skins + Nassau his whole life will freeze. **Fix:** wrap families 4+ behind a "More games ▾" disclosure. Default-visible: Skins, Nassau, Best Ball, Side Bets. Everything else collapsed.
- Gross/Net toggle with helper text "Lowest raw score wins…" / "Handicap strokes evened out — most member-member play uses net." (`page.tsx:1222-1227`). The copy is great. But the toggle defaults to Net on first enable (`family.defaultMode ?? "net"`, line 1083), which is right for member-member — confirm this is set in `lib/games/library.ts` and not Gross. **Fix:** verify every family with `hasMode` has `defaultMode: "net"`.
- Nassau config has three stake fields: Front / Back / Overall (`page.tsx:1276-1278`). First-timer playing a $5 Nassau enters $5/$5/$5 and gets a $15 round he wasn't expecting. **P1 fix:** show a live total under the inputs: "Total at risk: $15 / player". Or, simpler — single "Stake $" field that fills all three; add an "Advanced" toggle to split them.
- "Presses → Manual (commissioner adds during round)" option (`page.tsx:1293`). Word "commissioner" is undefined for a new user. **P2 fix:** "Manual (anyone can request mid-round)" — that's what manual presses actually are.

---

## 7. Enable junk — `page.tsx:970-1022`

**Works:** Toggle + flat amount is the right minimum viable surface. Default categories list (`Birdie, Eagle, Greenie, Sandy, Chip-in, Poley, Pinny`) is named the way golfers name them.

**Friction:**

- "Poley" and "Pinny" — `page.tsx:976-980`. Half the JGCC membership won't know these terms. (Poley = ball touching the flagstick on the green; Pinny = closest to the pin on a par-3.) **P2 fix:** add a tooltip-style "?" next to the category list. Or just remove Poley + Pinny from defaults — keep Birdie, Eagle, Greenie, Sandy, Chip-in as universally-known.
- The off-state shows no explanation of what junk IS until you toggle on. **Fix:** the "Birdies, greenies, sandies…" blurb at line 976 is already there — clean.
- "$2 flat per item" — fine, but no preview of "max risk." If 5 birdies and 3 sandies happen in a round, that's $16 of movement no one asked to think about. **P2 fix:** "Defaults to $2 each. A normal round sees 6-10 junk items moved." Sets expectation.

---

## 8. Live scoring — `group-score-entry.tsx` + `GroupScorePad.tsx`

**Works:** This is the strongest screen in the app. Per-hole context (Hole 3 · Par 4 · SI 7) is correct. Plus/minus buttons are 44x44px (`GroupScorePad.tsx:177, 192`) — Apple tap-target compliant. Stroke dots next to player names with proper a11y labels (lines 142-158) is *thoughtful*. The "+" defaults to par-1 on first tap (line 194) is correct golf intuition. Bottom-nav clearance via safe-area-inset-bottom (line 236) shows real iPhone testing.

**Friction:**

- The first hole defaults to "par on first +tap" via `(s ?? current.par - 1) + 1` (`GroupScorePad.tsx:194`). For a 50-year-old golfer who shoots bogey golf, his average score on a par-4 is 5, not 4. He'll tap + twice every hole. **P2 fix:** consider defaulting to par+1 (bogey) for players with HI > 15, par for HI ≤ 9, par-1 for plus indexes. Right now everyone starts at par.
- Hole nav strip (`GroupScorePad.tsx:92-117`) shows all 18 hole pills. On iPhone SE that's hard to scroll horizontally without misfiring. **Fix:** keep, but make the *active* pill 1.3x scale so the user always knows where they are even mid-scroll.
- The "9-key expanded chip pad" (`GroupScorePad.tsx:202-220`) shows 1-9 in a 9-col grid. A bogey golfer rarely shoots 1 or 2 on any hole; meanwhile, 10+ never appears. **Fix:** show 2-9 (drop 1) and add a single "10+" chip that opens a tiny number stepper. Tighter grid, cleaner.
- The "Done" button on the last hole goes to `/rounds/{id}#leaderboard` (`group-score-entry.tsx:177`). Not to finalize. A user who has entered every score expects "Done → Settle up". **P1 fix:** when every player has every hole scored, the Done button label becomes "Finalize round →" and goes to `/finalize`. The round-detail page already has an "All scores entered" banner — extend the same signal here.
- "Cards (mobile) / Grid (desktop)" toggle (`group-score-entry.tsx:148-169`). The labels are *descriptive of who should use them*, not of what they do. **P2 fix:** "Cards" / "Grid". Drop the parenthetical. The default-pick by viewport (line 41-43) already does the right thing.

---

## 9. Leaderboard — `app/(app)/rounds/[id]/page.tsx` + `components/Leaderboard.tsx`

**Works:** The mobile column set (Pos · Player · Today · Thru · Net) is correctly minimal. Movement indicators (`Leaderboard.tsx:190-205`) are subtle. Live pulse dot. "E" for even-par, +/-N format. Clean.

**Friction:**

- Round-detail page header at `app/(app)/rounds/[id]/page.tsx:188`: "Live leaderboard · 2026-05-12 · 18 holes". The date is ISO. **P2 fix:** "Saturday, May 12 · 18 holes". Same one-line `format-date.ts` helper you already have.
- Five tabs (`Leaderboard.tsx:24-35`): Gross, Net, Skins, Match, Bets. For a 50-year-old: "Match" and "Bets" — what's the difference? Match shows live match-play state; Bets shows $ flowing. A friendlier label split: **P1 fix:** "Match" → "Game"; "Bets" → "Money".
- "Today" column on mobile (`Leaderboard.tsx:165, 211-216`) is a vs-par number sized at `text-2xl sm:text-3xl`. Beautiful. But there's no column tooltip — what's the difference between "Today" and "Net"? They look like duplicates to a non-handicap-fluent eye when both render `+3`. **Fix:** add a thin `text-[10px]` clarifier row under header: "Today" → "vs par", "Net" → "after strokes". Or just drop one of the two on mobile.
- "Thru" column shows `F` at 18 (`Leaderboard.tsx:218`) — perfect. But a player who skipped a hole shows the number, not the gap. **P2:** edge case for shotgun starts only; fine for now.
- The round-detail page has SEVEN action tiles below the leaderboard (`page.tsx:391-457`): Enter scores, Leaderboard, Invite players, Edit games, View wagers, Finalize. Plus PressControls and JunkControls *above* the leaderboard. **P1.** Scrolling past press cards, junk entry, AND seven tiles to read a leaderboard is too much. **Fix:** put the leaderboard ABOVE press + junk controls (or collapse press/junk to a 1-line summary unless there's pending action). The leaderboard is what people came to see.

---

## 10. Settle up — `app/(app)/rounds/[id]/finalize/finalize-view.tsx`

**Works:** The "How this was calculated" `<details>` block (`finalize-view.tsx:451-484`) with chain-explanation copy is *the best thing in the entire app*. Lines 477-480 ("This transfer is part of a chain — Patrick owes a total of $12 but it's split across multiple recipients to keep the number of Venmo transfers low") is exactly the right tone and content. Whoever wrote that gets it.

**Friction:**

- Section header "Who pays whom" (`finalize-view.tsx:423`) is right; subheader "Computed by netting every game and finding the fewest transfers" (`line 425`) is also right. But the eyebrow `Settlement` (line 373) and h1 "Finalize round" (line 374) above are stiff. **P2 fix:** "Settle up" h1.
- Pending-press warning banner (`finalize-view.tsx:377-398`) is correct — but on a fresh round with no presses there's no positive confirmation. **Fix:** none needed if no presses; current behavior is right.
- The settle list shows `+$2.50` / `−$2.50` with `+` and `−` characters (`finalize-view.tsx:412`). Minus is U+2212 (real minus). Beautiful typography. On Venmo a user will manually re-enter the amount — no friction here.
- No Venmo-handle integration visible in the finalize view. The landing page promised "Final tally pre-fills Venmo with the right amount" (`app/page.tsx:62`). I see `VenmoQR.tsx` exists but it's not referenced in finalize. **P0 truth-in-advertising.** Either wire VenmoQR into each flow row, OR fix the landing copy to "Venmo handles are remembered for one-tap settle". A landing-page promise that doesn't show up in the experience is the #1 trust killer for a 50-year-old skeptic.
- "minimum flow" doesn't leak in copy — `finalize-view.tsx:425` says "fewest transfers". Clean. The variable name `minimumFlow` is internal-only. Good.
- gameErrors block (`finalize-view.tsx:492-510`) is fine for an edge case but the copy "stale player" (`line 507`) is engineer-speak. **P2 fix:** "missing data" or "incomplete scores".

---

## 11. Return next week — `/dashboard`

**Works:** "In progress" pill with one-tap "Enter scores · JGCC" link (`dashboard/page.tsx:408-427`) is exactly right for a Saturday returner mid-round. ClubhouseStrip is the moat — even on the dashboard, even non-clicking, it tells you the group has history.

**Friction:**

- "New round" button is top-right (`dashboard/page.tsx:328`), not particularly prominent. The hero space below the page header is taken by the (mostly empty for a new user) onboarding checklist, then ClubhouseStrip, then the active-round shortcut. For a returning user with no active round, "Start a new round" should be the obvious next step. **P1 fix:** make the "New round" button a full-width card under the page header for returning users with no active round, with a "Re-play with last round's lineup" sub-action.
- "Tip: swipe a round left, or tap the '⋯', to delete." (`dashboard/page.tsx:525`). Swipe-to-delete on a list of past rounds is *destructive UX* — a fat-fingered scroll can nuke a finalized round. **P0** — verify this actually soft-deletes (per CLAUDE.md `deleted_at` policy) and that there's an undo toast. If not, remove swipe-to-delete on finalized rounds.
- The "Archived rounds · N" `<details>` (`dashboard/page.tsx:535-567`) is good. Most new users will never see it. Clean.
- Quick Links grid (`dashboard/page.tsx:432-462`) has emoji per row. Patrick's CLAUDE.md says no cartoon emoji on records/streaks/milestones — these are *nav* glyphs so they're fine, but 📊🏆🗺️💵🛡️ are mixed-energy. The trophy + chart land "engagement-bait" adjacent. **P2 fix:** swap for matching line-icon set (Font Awesome / Lucide) or drop them — the labels are descriptive enough.

---

# Findings sorted by severity

## P0 — real golfer quits

1. **`app/login/page.tsx:125-126`** — "Look for an email from Supabase" exposes a vendor name that reads as phishing. Hide it.
2. **`app/(app)/rounds/new/page.tsx:1695-1707` (Teams drag-and-drop)** — drag-and-drop is broken / unreliable on iPhone Safari inside scrolling pages. Add a tap-to-assign fallback or it's a wall for any team format.
3. **`app/(app)/rounds/new/page.tsx:630-649`** — course-issues amber banner can fire on JGCC even though JGCC is `status='verified'`. A new user seeing "net handicap math will be off until it's fixed" on his home course will close the tab. Suppress for verified courses.
4. **`app/(app)/rounds/[id]/finalize/finalize-view.tsx`** — landing page promises "Venmo handles pre-fill the right amount"; finalize view doesn't show Venmo. Either wire `VenmoQR` into each settle row or fix the landing copy.
5. **`app/(app)/dashboard/page.tsx:525`** — "swipe to delete" tip on finalized rounds. Verify soft-delete + undo path; if missing, remove the swipe action.

## P1 — real golfer grumbles

6. **`app/(app)/rounds/new/page.tsx` section ordering** — move Quick Start above Players. A first-timer should land on a one-tap preset before being asked to configure anything.
7. **`app/(app)/rounds/new/page.tsx:933-962`** — collapse 10+ game families behind a "More games ▾" disclosure. Show only Skins, Nassau, Best Ball, Side Bets by default.
8. **`app/(app)/rounds/new/page.tsx:1276-1278`** — Nassau three-stake input ($5 × 3 = $15 surprise). Single "Stake $" field that auto-mirrors to F/B/Overall; show "Total at risk per player" live.
9. **`app/(app)/rounds/new/page.tsx`** — show Course Handicap inline next to each picked player's HI input. Golfers want to verify their strokes BEFORE tee-off.
10. **`app/login/page.tsx:150-151`, `app/signup/page.tsx:174-175`** — move Google/Facebook OAuth above email/password.
11. **`components/GroupScorePad.tsx:240-272`** — "Done" on last hole goes to `#leaderboard`; should go to `/finalize` when every player has every hole scored.
12. **`components/Leaderboard.tsx:33-34`** — "Match" → "Game", "Bets" → "Money".
13. **`app/(app)/rounds/[id]/page.tsx`** — leaderboard sits BELOW press + junk controls + 7-tile action grid. Move leaderboard above controls, collapse controls to a one-line strip when nothing is pending.
14. **`app/(app)/dashboard/page.tsx`** — for returning users with no active round, make "New round" a hero card (not a top-right text button), with "Re-play with last round's lineup" sub-action.
15. **`app/signup/page.tsx:163`** — bump "Minimum 8 characters" hint from 10px to 12-13px and add live validation.

## P2 — polish

16. **`app/page.tsx:33-37`** — demote "I have an account" to a small text link.
17. **`app/page.tsx:40`** — "wagers" → "groups" or "weekend games."
18. **`app/page.tsx:77-90`** — kill the duplicate demo strip OR the hero demo button. One demo CTA.
19. **`app/signup/page.tsx:131-155`** — collapse First + Last name into single "Full name."
20. **`app/(app)/rounds/new/page.tsx:822-828`** — hide Teams section until a team game is enabled.
21. **`app/(app)/rounds/new/page.tsx:705,751`** — handicap placeholder `"14.0"`, move "+plus index" hint behind an info icon.
22. **`app/(app)/rounds/new/page.tsx:688-718`** — make guest HI optional with "leave blank for scratch" helper.
23. **`app/(app)/rounds/new/page.tsx:735`** — "New to this group" → "First round with the crew."
24. **`app/(app)/rounds/new/page.tsx:1293`** — "Manual (commissioner adds…)" → "Manual (anyone can request mid-round)."
25. **`app/(app)/rounds/new/page.tsx:976-980`** — tooltip glosses for Poley/Pinny, or drop them from defaults.
26. **`components/GroupScorePad.tsx:202-220`** — score chip pad: drop "1", add "10+" with stepper.
27. **`app/(app)/rounds/[id]/page.tsx:188`** — date as "Saturday, May 12" not ISO.
28. **`app/(app)/rounds/[id]/finalize/finalize-view.tsx:374`** — "Finalize round" → "Settle up" h1.
29. **`app/(app)/rounds/[id]/finalize/finalize-view.tsx:507`** — "stale player" → "missing data."
30. **`app/(app)/dashboard/page.tsx:432-462`** — replace emoji nav glyphs with a coherent icon set.

---

**Top three to fix this week:** Supabase email name (P0 #1), Teams drag-and-drop fallback (P0 #2), course-issues banner suppression on verified courses (P0 #3). Those three alone get the round-creation completion rate up materially with eight JGCC guys on a Saturday morning.
