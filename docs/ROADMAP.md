# Roadmap

Roughly ordered by value-per-effort. Reorder freely.

## Near-term (post-MVP)

- **Stableford** scoring + game format.
- **9-hole rating support** (use real 9-hole rating/slope when courses publish them).
- **Offline score entry**: optimistic local writes with a sync queue. PWA install prompt.
- **Push / SMS** "you owe $X" + "your group started" via Twilio.
- **PDF export** of finalized scorecard + settlement summary.
- **Round templates**: save a configured round (course, tees, games, stakes) as a template the commissioner can clone.
- **Leaderboard sharing**: rich text for SMS / Slack with the live link.

## Medium-term

- **Course data adapter** for `golfapi.io` or another licensed source so commissioners don't hand-enter hole pars.
- **Dollar-per-stroke / Quota** games.
- **Hammer / Hammer Press** rules support.
- **Wolf**, **Bingo Bango Bongo**, **Vegas**, **Defender** game formats.
- **Hi-Lo** and **6-6-6** team rotations.
- **Season standings**: roll up ROI / wins / handicap progression across rounds for a group.
- **Calendar integration** (iCal / Google Calendar invite for scheduled rounds).

## Long-term

- **GHIN GPA integration** (only if/after USGA program approval).
- **Multi-group billing**: free tier / paid tier with per-group seat limits.
- **Captain/club portal** for running a 30-player members' day.
- **Native app shell** (Expo) wrapping the same web app for richer push + camera.
- **Apple Watch / Garmin** companion for hands-free score entry.
- **AI scorekeeper assistant**: voice ("two over on 7") via Whisper → score entry.
- **Stat dashboards**: shots gained, fairways hit, GIR — given enough optional inputs.
