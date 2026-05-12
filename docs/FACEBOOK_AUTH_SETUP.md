# Facebook login setup (one-time, Patrick-only)

**Status:** Code shipped 2026-05-12. Backend setup pending.
**Time:** ~15 minutes.

The "Continue with Facebook" button is live on `/login` and
`/signup`. Tapping it today returns Supabase's "provider is not
enabled" error because no Meta app is wired up yet. Three
configuration steps to flip it on. Everything below requires
Patrick's personal Meta + Supabase access — I can't do any of it
from this side.

---

## 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com/)
   and sign in with the Facebook account you want to OWN the app.
   (Personal works; a Business account is optional.)
2. Click **My Apps → Create App**.
3. Use case: **Authenticate and request data from users with Facebook
   Login**. Click **Next**.
4. App type: **Consumer**. Click **Next**.
5. App display name: **Cruz Golf**. Contact email: your email.
   Click **Create app**.

You'll land in the app dashboard.

---

## 2. Configure Facebook Login → OAuth redirect

1. In the left sidebar, click **Facebook Login → Settings** (if
   it's not in the sidebar, click **Add Product** → find Facebook
   Login → Set up first).
2. **Client OAuth Login:** Yes
3. **Web OAuth Login:** Yes
4. **Enforce HTTPS:** Yes
5. **Valid OAuth Redirect URIs:** paste both of these (one per
   line):
   ```
   https://<YOUR-SUPABASE-PROJECT-REF>.supabase.co/auth/v1/callback
   https://cruz-golf.vercel.app/auth/callback
   ```
   The Supabase one is the OAuth callback Meta posts to. Get the
   project ref from your Supabase URL — it's the subdomain. The
   Cruz Golf one is your production redirect.
6. Click **Save changes**.

---

## 3. Grab App ID + App Secret

1. In the left sidebar: **Settings → Basic**.
2. Copy **App ID** (visible).
3. Click **Show** next to **App Secret**, enter your password,
   copy the secret.

Don't paste these anywhere except Supabase. They're not in version
control on purpose.

---

## 4. Wire into Supabase

1. Open the [Supabase dashboard](https://supabase.com/dashboard) →
   your Cruz Golf project.
2. **Authentication → Providers** in the left sidebar.
3. Find **Facebook**. Click to expand.
4. **Enabled:** toggle on.
5. Paste the **App ID** in the Client ID field.
6. Paste the **App Secret** in the Client Secret field.
7. **Save**.

Supabase generates the callback URL it expects — that's the same
URL you pasted into Meta in step 2 (Supabase project URL +
`/auth/v1/callback`). If Supabase shows a different URL, copy
THAT one back to Meta's OAuth redirect URIs list.

---

## 5. Switch the Meta app to Live mode

The app starts in Development mode — only listed test users can
authenticate. To open it up to real users:

1. Back in [developers.facebook.com](https://developers.facebook.com/),
   open the app dashboard.
2. Top bar toggle: switch from **Development** to **Live**.
3. Meta will require a Privacy Policy URL + a Terms URL. Use the
   policy pages Cruz Golf already publishes (or any pair of static
   URLs that resolve — Meta doesn't verify content, just
   reachability).
4. Save.

---

## 6. Test

1. Go to `https://cruz-golf.vercel.app/login`.
2. Click **Continue with Facebook**.
3. You should bounce through facebook.com → back to `/auth/callback`
   → into `/dashboard`. New user → through `/onboarding` first.

If you see an error like "URL Blocked: This redirect failed
because the redirect URI is not whitelisted in the app's Client
OAuth Settings", the URL in step 2 above doesn't exactly match
what Meta is seeing. Copy the EXACT URL Supabase says it expects
(in step 4) back to Meta's redirect URI list.

---

## What you get once it's live

| Feature | Inheritance from Facebook |
|---|---|
| Sign in with one tap | ✓ |
| Avatar image | Pulled from Facebook profile picture (`user_metadata.avatar_url`) automatically. The round-leaderboard player avatars will populate without any extra step. |
| Display name | Pulled from Facebook full name (`user_metadata.full_name`). |
| Friends graph | Not exposed by default — Meta restricts this in newer API versions. We'd need separate Graph API consent for friend invites. Not implementing today. |
| Sharing to FB | The browser's native Share Sheet already handles this from `/leaderboard?token=...` URLs (our existing spectator link). Not a separate integration. |

---

## What we're NOT doing today

- **Facebook friend graph + invite by FB friend list.** Meta's
  `user_friends` permission requires an App Review and a
  documented use case. The friction is high relative to the value
  — we already have spectator-link sharing (copy URL → SMS / WhatsApp).
- **Posting rounds back to Facebook timeline.** Same App Review
  story plus the user's feed isn't a great place for golf scores
  (most golfers don't want their boss seeing their +12).
- **Linking an existing Cruz Golf account to a Facebook identity.**
  Supabase supports identity linking via `linkIdentity()` but the
  UX is awkward (modal that pops the OAuth window). Skip unless
  someone asks.

The narrow promise of Facebook login on Cruz Golf today is: "one
tap sign-in + a profile photo." That's the value we ship.
