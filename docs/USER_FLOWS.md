# User flows

## 1. First-time setup (commissioner)
1. Sign up → land on Onboarding.
2. Create a Group ("Saturday Crew"). Becomes group owner.
3. Add players: name, optional email/phone/GHIN, current Handicap Index. Mark guests as `is_guest`.
4. Add a course: name, location, then add tees with rating/slope/par + 18 holes (par + SI per hole).
5. Land on dashboard.

## 2. Create a round
1. Dashboard → "New round".
2. Pick course → pick tees per player → pick players (multi-select) → optionally make teams.
3. Pick game(s): individual_net, skins_net, nassau, etc. Each opens its config drawer.
4. App auto-computes course handicap + playing handicap per (player, tee, game allowance). Commissioner can override any value.
5. "Start round" → status `live`. Round dashboard appears with live leaderboard skeleton.

## 3. Live scoring (player on phone)
1. Open share link or dashboard tile.
2. Tap own row → Score Entry screen.
3. Big steppers per hole, swipe to next hole. Each tap writes optimistically + syncs to Supabase.
4. Leaderboard tab shows live standings; bets tab shows projected payouts.

## 4. Score correction (commissioner)
1. Tap any score in leaderboard → "Edit score" sheet.
2. Enter new gross + reason.
3. Confirms → writes new `scores.gross` + appends `score_events` row.
4. Standings recompute live for everyone.

## 5. Scorecard photo upload
1. Round dashboard → "Upload card".
2. Pick a player → select/take photo.
3. Server runs OCR → returns {hole: gross} grid.
4. Review screen pre-fills the score grid; user adjusts any wrong cells.
5. Tap "Save 18 scores" → batch insert. Photo URL retained on the round.

## 6. Finalize round
1. Commissioner taps "Finalize".
2. App locks all scores, runs every configured game's settlement, generates `settlements` rows.
3. "Who pays whom" screen with one-tap "share to text" payload.

## 7. Spectator
1. Commissioner taps "Share spectator link" on the round dashboard.
2. Public URL with `spectator_token` shows a read-only leaderboard. No login.
