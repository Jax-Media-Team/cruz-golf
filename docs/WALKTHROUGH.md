# Cruz Golf — Walkthrough

A 5-minute tour of the app. Two paths: poke at the **demo** (no setup) or hook up Supabase and run the real thing.

## Path A — Demo, right now (zero setup)

The demo runs entirely on hardcoded data. No login, no database.

1. Make sure the dev server is running: `npm run dev` from `golf-games-app/`. Visit http://localhost:3000.
2. On the landing page, click **Tour the demo** (or go directly to http://localhost:3000/demo).
3. From the demo home, hit each card in order. Suggested order:
   - **Round dashboard** — the live leaderboard. Toggle the tabs at the top: Gross / Net / Skins / Team / Bets. Tap any player row to drop into score entry.
   - **Score entry** — pick a player from the dropdown at the top. Use the +/− steppers or tap a number chip. Hit **Next →** to move through holes. Changes only persist in your browser tab.
   - **Player profile** — Cruz's profile by default; the chip row at the top switches to Jeff / Marco / Taylor. Each one has season stats, scoring distribution (eagles / birdies / pars / etc.), recent rounds, and a Venmo QR pre-filled with the amount they currently owe.
   - **Group ledger** — running who-up-who-down for the season, with a one-tap "Pay" button on each owed line that opens Venmo with the amount filled in.
4. Mobile check: open Chrome DevTools, toggle device emulation (Cmd/Ctrl-Shift-M), pick **iPhone 14 Pro**. The leaderboard collapses to a 5-column layout (Pos · Player · Today · Thru · Net). Tab strip is sticky at the top. Score entry uses big tap targets sized for one thumb.

## Path B — Real app with Supabase

About 10 minutes once.

1. **Create a Supabase project** at https://supabase.com → New project. Pick a region near you. Wait ~2 min for provisioning.

2. **Apply the migrations.** Open the SQL Editor in Supabase. For each file in `supabase/migrations/` *in order* (0001 → 0006), paste the contents and click Run.
   - `0001_init.sql` — schema, RLS, audit trigger.
   - `0003_round_access.sql` — round PINs + invitee table.
   - `0004_invites_and_stats.sql` — single-use invite tokens.
   - `0005_wagers_and_share.sql` — wager-handshake table + tightened RLS.
   - `0006_venmo_and_avatars.sql` — Venmo handle + avatar columns.
   - `0002_seed.sql` — **run this last**, after you've signed up. Inserts the full Saturday Crew demo group + JGCC course + an in-flight round + a finalized round. Idempotent.

3. **Grab API keys.** Settings → API. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` *(keep secret, server-only)*

   Paste them into `golf-games-app/.env.local`. Restart the dev server.

4. **Optional — Google sign-in.** Authentication → Providers → Google. Enable, paste a Google OAuth client ID/secret. Add `https://<your-project>.supabase.co/auth/v1/callback` to "Authorized redirect URIs" in Google Cloud Console.

5. **Sign up** at http://localhost:3000/signup with your real email + group name. Once your profile exists, run `0002_seed.sql` to populate the demo data linked to you.

6. **Refresh /dashboard.** You should see two rounds (one live, one finalized), four players, and JGCC in your courses.

7. **Try the seamless flows:**
   - **Add a guest player mid-setup**: New round → Players section → "Add a guest player" form right above the existing roster. Fills in name + handicap, taps Add, immediately picked for this round.
   - **Random pairings**: Same wizard → Teams section → bump the team count → 🎲 Random pairings. Drag-and-drop also works to override.
   - **Round PIN + invite**: Open the live round → header shows the 4-digit PIN (commissioner only). Tap **Invites** → generate a per-person invite. Tap **Copy invite** to drop the message into iMessage / WhatsApp.
   - **Claim your spot**: When someone joins via invite, the round page shows them a "Claim your spot" banner with the unclaimed players. Tapping their name links their profile to that player record so all future stats flow to the right person.
   - **Wager handshake**: If the round has stakes > 0, players see a yellow-bordered banner pushing them to confirm wagers. Score entry is RLS-blocked until they ack.
   - **Public leaderboard**: Round header → **Spectator link**. Anyone with the URL gets a read-only live leaderboard, no login needed.
   - **Share image**: Round header → **Share image**. Returns a 1200×630 PNG with the leaderboard + settlement chips, branded with your logo. Same image is auto-attached to the spectator URL via OpenGraph, so iMessage/WhatsApp unfurl it inline.
   - **Settle the round**: **Finalize** button → settlement page → **Open share image** / **Download PNG**. Round status flips to `finalized`, settlement rows go into the season ledger.

## What's where (cheat sheet)

| Need | Where |
|---|---|
| Sign up / log in | `/signup` · `/login` |
| Today's round | `/dashboard` → tap a round → `/rounds/[id]` |
| Score yourself | Round → tap your row in leaderboard → `/rounds/[id]/score` |
| Add a player | `/players` → Add player (or inline guest in round wizard) |
| Player stats | `/players/[id]/stats` |
| Add a course | `/courses` → Add course (or one-tap "Add Jacksonville G&CC") |
| Configure a round | `/rounds/new` |
| Generate per-person invites | Round header → **Invites** |
| Confirm wagers | Round → yellow banner → `/rounds/[id]/wagers` |
| Public scoreboard | Round header → **Spectator link** |
| Settle up | Round → **Finalize** |
| Season totals | `/ledger` |
| Demo (no login) | `/demo` |

## Mobile tips

- The bottom tab bar is your shortcut on phones — Rounds / Players / Courses / Ledger.
- The score entry view is designed for one-thumb operation on the cart. Big tap targets, no horizontal scroll required.
- iOS users: from Safari, **Add to Home Screen** to install Cruz Golf as a PWA. The PWA opens chromeless and uses the logo as its app icon.

## Troubleshooting

- **Logo broken** — drop your image into `public/cruz-logo.png`. That's it.
- **"Insert violates row-level security policy"** — you're not in any group yet. Sign up first, then run `0002_seed.sql`.
- **Score won't save** — the round has stakes, the user hasn't acked the wagers, or they aren't an invitee. Use the yellow banner on the round page.
- **Demo screens look broken on mobile** — they shouldn't, but if a tab strip overlaps the content, it's the sticky-top behavior; scroll up briefly.
