# Stability & external dependencies

What can fail, what doesn't, and how the app degrades when it does.

---

## External services Cruz Golf actually talks to

| Service | Purpose | Free-tier limit | What happens at the limit |
|---|---|---|---|
| **Supabase Auth** | Sign-up, sign-in, session | ~30 sign-ups/hour, ~30 password attempts/hour per IP | New users get rate-limited. Existing logged-in users unaffected. Friendly message via `friendlyAuthError`. |
| **Supabase REST (PostgREST)** | All DB reads/writes | No hard request cap; 500 concurrent connections | Effectively never hit by a single private group. |
| **Supabase Realtime** | Live leaderboard, score-update broadcast | 200 concurrent clients per project, ~2 messages/sec/channel | Plenty for any private group/event. Beyond limit → drops messages, then dropouts; SDK auto-reconnects. We ALSO refetch on (re)subscribe + every 60s as a safety net. |
| **Vercel** | Hosting, edge, OG image render | 100 GB bandwidth/mo, 100k Edge fn invocations/mo | Enough for hundreds of rounds. Beyond → 429s on Edge, app stays up but OG images may stutter. |
| **OpenAI Vision** *(optional)* | Scorecard photo OCR | 3 RPM on free tier, then paid | OCR retries up to 4× with exponential backoff (`lib/retry.ts`). If it gives up, the upload screen falls back to a hand-fill grid. |
| **GitHub** | Pushes only at deploy | 5000 calls/hr | Never user-facing. |

**Cruz Golf makes ZERO calls to LLM/AI services in the user's normal flow.** The Smack Talk recap engine is a pure JS algorithm in `lib/recap.ts`. Handicap math, leaderboard math, settlement engine, all the games — pure functions, no network.

---

## What we explicitly hardened

### 1. Friendly auth errors — `lib/auth-errors.ts`
Used by `/login` and `/signup`. Translates raw Supabase errors:
- "Could not find the table … schema cache" → "Server is still warming up. Wait 30 seconds and try again."
- "User already registered" → "An account with that email already exists. Try signing in instead."
- "Invalid login credentials" → "Wrong email or password."
- "Email rate limit exceeded" → "Too many attempts. Wait a minute and try again."
- "Row-level security violates" → "Something on our side blocked that. Refresh and try again, or tell Cruz."

Anything we don't recognize falls through to a generic "Something went sideways" — we never expose Postgres or PostgREST internals to users.

### 2. Retry helper with exponential backoff — `lib/retry.ts`
```ts
await retry(() => fetch(url), { attempts: 4, baseMs: 500 });
```
- Retries on `429`, `5xx`, network errors, timeouts, aborts
- Per-attempt jitter prevents thundering herd
- Used by the OpenAI OCR call

### 3. OCR endpoint — `lib/ocr/index.ts`
Wraps the OpenAI fetch in `retry()`. A 429 on the first attempt → ~1s pause → retry. Up to 4 attempts before giving up. Even if it gives up, the `/rounds/[id]/upload` route shows the parsed-as-blank grid so the user can hand-fill scores.

### 4. Realtime reconnect safety-net — `app/(app)/rounds/[id]/round-view.tsx`
- Supabase SDK auto-reconnects sockets on its own
- We additionally **refetch all scores on every successful (re)subscribe**, so anything missed while disconnected catches up
- Plus a **60-second safety refetch** in case Realtime silently drops a message
- Net effect: even if Realtime misbehaves, the leaderboard reconciles within a minute

### 5. Wager handshake & PIN access (already in schema)
RLS prevents non-invitees from writing scores. If somehow a request slips through, the constraint blocks it — there's no path for a non-authorized user to insert a score.

### 6. Settlement = client-side pure function
The `settleGame` engine and `minimumFlow` algorithm run client-side. No external dependencies. If Supabase is down, the leaderboard won't update but the engine still computes correctly from whatever scores are loaded.

### 7. Demo mode = zero dependencies
`/demo` and its sub-routes use `lib/demo.ts` static fixtures. No DB, no auth, no realtime. If everything else fails, demo still works.

---

## What is NOT affected by Anthropic / OpenAI rate limits

✅ Score entry (Postgres only)
✅ Live leaderboard (Supabase Realtime)
✅ Invites (Postgres only)
✅ Wager handshake (Postgres only)
✅ Settlement (pure JS)
✅ Demo mode (static)
✅ Public spectator leaderboard (Postgres only)
✅ OG share image (Vercel render → Supabase read)

---

## What IS affected by an OpenAI rate limit

❌ Scorecard photo OCR (and only when `OPENAI_API_KEY` is set)
- User uploads photo → endpoint retries OCR up to 4× with backoff → on persistent failure, returns a blank grid the user can edit
- Never blocks the round from being scored — the upload feature is a convenience, not a dependency

---

## Failure-mode reference table

| If this fails | The user sees | The app keeps working for |
|---|---|---|
| Anthropic chat (this conversation) | Slowness from me | Everything (this is unrelated to the deployed app) |
| Supabase Auth signup | Friendly "wait a minute" | Existing logged-in users, demo, public leaderboard |
| Supabase REST | "Connection hiccup, retrying" | Demo, share-image PNG (which uses service role) |
| Supabase Realtime | Stale leaderboard up to 60s | Score entry (writes still go through), demo |
| OpenAI OCR | Blank grid to hand-fill | Everything else |
| Vercel | Whole site offline | Nothing — but failure is rare |

---

## What to add later if scale demands

- **Edge caching of the spectator leaderboard** for events with 100+ watchers (right now each viewer hits Realtime directly)
- **Server-side caching of OG share image renders** (currently 30s; could push to 5 min for finalized rounds)
- **Per-IP rate limit** on `/api/scorecard-ocr` to prevent budget burn from accidental spam
- **Sentry or Logflare** for error capture in prod (right now we silently swallow failures into friendly UI messages — fine for testing, less fine at scale)

None of these are needed now.
