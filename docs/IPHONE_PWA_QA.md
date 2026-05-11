# iPhone PWA — manual QA checklist

Step-by-step walkthrough for testing Cruz Golf as an installed iPhone PWA.
Run this on a real device (the simulator skips PWA-only behavior).

Each step has an **expected behavior** and a **failure mode** so you know
what bug to file if something looks wrong.

---

## Recently changed (test these specifically, 2026-05-11)

These three changes shipped without device verification. **Re-install
the PWA before testing** — Safari caches `manifest.webmanifest` and
the viewport meta tag.

1. **Manifest deduplication** — `app/manifest.ts` deleted, only the
   static `public/manifest.webmanifest` is served. Verify the icon,
   start_url (should land on `/dashboard`), and orientation (locked
   to portrait) are right.
2. **`viewport-fit: cover`** added — the app should now use the FULL
   screen edge-to-edge on a notch / Dynamic Island iPhone, with the
   safe-area-inset values applying to the header + bottom nav. If the
   app letterboxes (black bars top/bottom), the `<meta
   name="viewport">` tag isn't picking up the new value.
3. **`maximumScale: 1` removed** — pinch-zoom is now allowed. Verify
   you CAN double-tap or pinch to zoom on text. If the page locks,
   the old viewport is cached — force-quit and reopen.
4. **`themeColor` synced to `#0a1f1a`** — should match the brand-900
   background. Cold-launching the PWA should NOT flash to a different
   green tint between the iOS launch screen and the first render.

---

## Setup — install the app

1. Open Safari → navigate to your production URL (or `npm run dev` + Caddy
   if testing locally).
2. Tap the Share icon → "Add to Home Screen" → confirm.
3. Quit Safari completely (swipe up + flick away). Tap the new Cruz Golf
   icon from the home screen.

**Expected:**

- Launches full-screen with no Safari chrome (no URL bar, no tabs bar).
- Status bar text is light (over the dark brand-950 header).
- Brand mark + nav header are clear of the iPhone notch / Dynamic Island.

**Failure mode:**

- If the URL bar shows, the PWA isn't installed correctly — re-add.
- If content overlaps the notch, `pt-[env(safe-area-inset-top)]` on the
  header isn't applying.

---

## 1. Installed app launch (cold start)

1. With the app installed, force-quit it.
2. Turn airplane mode ON.
3. Tap the Cruz Golf icon.

**Expected:**

- App opens to `/dashboard` (or `/login` if you're signed out).
- The brand header + bottom nav render immediately.
- A small amber pill at the top reads **"Offline · scores will sync when
  you reconnect"**.
- The dashboard's clubhouse strip + rounds list show their **loading
  skeletons** (gray pulse cards) and don't paint blank.

**Failure mode:**

- Blank white screen → service worker isn't activating. Check
  DevTools → Application → Service Workers via Safari Remote Debug.
- Header missing safe-area inset → re-check `app/(app)/layout.tsx` line
  121 `pt-[env(safe-area-inset-top)]`.

---

## 2. Reload after deploy (cache invalidation)

1. With the app installed and open, make a code change + redeploy (or
   bump the version manually in `lib/useVersionWatch.ts`).
2. Wait 30 seconds (the version watcher polls).

**Expected:**

- A small "Update available" toast appears bottom-left with **Refresh**
  + **Later** buttons.
- The toast sits clear of the iPhone home indicator (safe-area inset is
  applied — fixed in commit c40b321).
- Tapping Refresh reloads the app to the new version.
- Tapping Later dismisses for the session.

**Failure mode:**

- Toast overlaps the home indicator → bottom-[calc(...)+env(...)] isn't
  in `components/UpdateToast.tsx`.
- App doesn't pick up the new version → service worker `CACHE_VERSION`
  bump didn't happen (it's in `public/sw.js`).

---

## 3. Score entry — happy path

1. Open a live round (or create one).
2. Tap "Enter scores" → score-group page.
3. Tap each player's chip rail or ± buttons to enter scores.

**Expected:**

- Buttons feel native (no input zoom; chip rail tap target is large enough
  for a thumb).
- After every save, a small gold pill appears top-right reading
  **"Saving…"** then disappears within ~500ms when the write lands.
- Auto-advance: when every selected player has a score on the current
  hole, the page advances to the next hole automatically.
- Scores you've entered persist if you navigate away + back.

**Failure mode:**

- The page jumps when the "Saving" pill appears/disappears → fixed
  position pill, but verify on a small viewport.
- "Saving" pill stuck (never goes away) → the write failed silently.
  Check the red SaveStatusBanner — should appear with Retry / Diagnose /
  Discard.

---

## 4. Bottom nav + safe-area

1. On any page, look at the 5-tab mobile bottom nav (Rounds / Players /
   Courses / Boards / More).
2. Verify the iPhone home indicator is BELOW the nav buttons, not
   overlapping them.

**Expected:**

- Tap targets are at least 44pt high.
- Home indicator zone (the bottom ~34pt strip) is below the nav.
- The nav itself has a subtle backdrop blur — content scrolling underneath
  shows through with reduced contrast.

**Failure mode:**

- Buttons overlap the home indicator → `paddingBottom:
  env(safe-area-inset-bottom)` is missing from the nav.

---

## 5. Active round pill

1. Make sure a live round exists.
2. Navigate away from `/dashboard` and the round itself (e.g. /leaderboards).

**Expected:**

- A gold pill appears bottom-right reading **"Live · [course name] →"**.
- Tapping it returns you to the round page.
- A small × on the right dismisses it for the session.
- The pill sits clear of the home indicator (calc-based bottom position).
- On `/dashboard` and `/rounds/[id]`, the pill is hidden (the dashboard
  has its own hero card; the round page IS the destination).

**Failure mode:**

- Pill overlaps the home indicator → `bottom: calc(5rem +
  env(safe-area-inset-bottom, 0px))` is missing or overridden.

---

## 6. Help button

1. On any page (e.g. /leaderboards), look for the gold "?" button.

**Expected:**

- Button sits bottom-right, **above** the active round pill (so neither
  is covered).
- Tap opens a help dialog that fuzzy-searches the 41-entry knowledge
  base.
- Search "press" returns the 5 press-related entries.
- Dialog closes on backdrop tap or × button.

**Failure mode (fixed in commit c40b321):**

- Help button covered by the pill → check that `HelpButton` has
  `bottom-[calc(9rem+env(safe-area-inset-bottom,0px))]`.
- Dialog overlaps the home indicator → it's `inset-0` so this shouldn't
  happen; if it does, check z-index stacking.

---

## 7. Press notifications

1. **Setup:** create a live round with at least 2 players. From player
   A's device, open a manual press against player B.

2. **On player B's device** (already on the round page):
   - **Expected:** a "Press requested" banner appears at the top of the
     round page within ~2 seconds of player A opening it. No reload
     needed. Banner shows the segment label, stake, hole range, and
     Accept / Decline buttons.

3. **On player B's device, navigate to `/dashboard`** (or any other
   non-round page):
   - **Expected:** the floating active-round pill flips from gold ("Live
     · [course]") to **amber ("Press pending · [course]")**. Within ~2
     seconds of opening. The amber pulse on the indicator dot signals
     the alert state.

4. **On player A's device** (the opener):
   - **Expected:** their own pending press shows in a "Press pending"
     card on the round page with a Withdraw button. No alert pill (the
     opener doesn't need to be alerted — they opened it).

5. **Tap Accept on player B's device:**
   - **Expected:** banner disappears on B's device immediately. Player
     A's pending card flips to an "accepted" strip with a green dot.
     The pill on every player's other devices goes back to gold.

**Failure mode:**

- No banner / no pill flip → realtime subscription failed. Check Safari
  DevTools → Storage → IndexedDB → `supabase-auth-token` exists. Try
  manually refreshing to see if it's a realtime issue or a fetch issue.
- 60-second delay before banner appears → realtime socket dropped; the
  60s safety-net is the fallback. This is acceptable; less than 5s is
  ideal.

---

## 8. Offline / reconnect behavior

### 8a. Lose connection mid-scoring

1. Open a live round, enter a few scores online.
2. Toggle airplane mode ON.
3. Continue entering scores for the next few holes.

**Expected:**

- Amber "Offline · scores will sync when you reconnect" pill appears at
  the top.
- Score entry continues to work normally — taps still update the UI
  immediately.
- Each new score shows a "Saving…" pill that DOES NOT go away (queue is
  building).
- No errors surface.

### 8b. Reconnect

4. Toggle airplane mode OFF.

**Expected:**

- Offline pill disappears within ~3 seconds (browser fires `online`
  event).
- All queued "Saving…" pills resolve within ~5 seconds.
- The leaderboard updates with the queued scores via the
  reconnect-refetch in `round-view.tsx`.
- No data loss — every score you entered offline is now in the
  database.

### 8c. Close + reopen with pending queue

1. Repeat 8a — go offline, enter scores.
2. Force-quit the app while still offline.
3. Reopen the app while still offline.

**Expected:**

- The score-entry page (if you navigate to it) shows the previously-
  entered scores (they're in the localStorage queue + UI state).
- The "Saving…" pills are still showing.
- When you turn airplane mode off, the queue drains automatically (the
  hook listens to `online` events on the window).

**Failure mode:**

- Pending scores lost on app close → `localStorage` persist failed.
  Check that the queue was saved (`window.localStorage.getItem("cruz-
  golf:pendingScores:v1")` in DevTools).
- Pills stuck after reconnect → the auth token expired during the offline
  window. `useScoreSaver` should auto-retry on TOKEN_REFRESHED; if it
  doesn't, the SaveStatusBanner red banner gives you Retry / Discard.

### 8d. Press accept while offline

1. With airplane mode ON, tap Accept on a pending press.

**Expected:**

- A small red error message appears: **"You're offline. Try again when
  you reconnect."**
- The press stays in the "Press requested" banner — no state change.
- Re-trying after reconnect succeeds.

**Failure mode:**

- Raw "fetch failed" surfaces → the offline-detection in
  `pressErrorMessage` (`press-controls.tsx`) isn't running. Should be
  fixed in commit 5f7e78d.

---

## 9. Lifecycle transitions

1. Score every hole for every player on a live round.

**Expected:**

- An "All scores entered" green banner appears with two CTAs: Finalize
  now, or Move to awaiting finalization.

2. Tap Finalize → finalize page.

**Expected:**

- The settlement view renders showing per-game lines + minimum-flow
  Venmo edges.
- **If any press is pending and not expired:** amber warning banner at
  the top reads "N presses still pending · Finalizing now drops them"
  with a "← Back to round" link.

3. Tap "Lock settlements" / "Finalize."

**Expected:**

- Round transitions to `finalized`. Read-only state.
- Settlements are written to the database. The /ledger page shows the
  net changes.
- The active-round pill disappears.

**Failure mode:**

- Finalize without a pending-press warning when one exists → the
  finalize page's `pendingPressCount` fetch failed silently. Check
  `app/(app)/rounds/[id]/finalize/page.tsx` lines 32-60.

---

## Known gaps (still need real-device confirmation)

These cannot be programmatically verified — they require eyes-on testing:

1. **Service worker activation timing** after a fresh install on iPhone
   — sometimes Safari delays SW registration. The
   `<ServiceWorkerRegistration>` component skips in dev and only runs on
   `window.load`.
2. **Home-indicator clearance** on different iPhone models. iPhone SE
   (no notch) vs iPhone 15 Pro (Dynamic Island) have different
   safe-area values. The PWA spec says env(safe-area-inset-*) returns
   the right value for each — but verify.
3. **Realtime over LTE/5G with poor signal** — the Supabase socket can
   silently drop. The 60s safety-net refresh covers it, but lag may be
   noticeable in the field.
4. **Push notifications** for press requests — not implemented. The
   pill alert + in-app banner are the only signals. If the user has
   the app in the background, they won't know until they open it.

If any of these become a problem, file as `MOBILE-XXX` in the tracker.
