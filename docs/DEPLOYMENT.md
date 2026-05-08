# Deployment

End-to-end steps to take Cruz Golf from your laptop to a live URL on a custom domain.

---

## Where things live right now

- **Local code:** `C:\Users\patri\Documents\golf-games-app`
- **Git:** initialized, branch `main`, commits in. *No remote yet.*
- **GitHub:** repo not yet created.
- **Supabase:** no project yet — required for auth/DB to work in production.
- **Vercel:** no project yet.
- **Live URL:** none yet.

You can pick this back up at any time by reopening the folder in your editor and running `npm run dev`.

---

## Step 1 — Create the GitHub repo (browser, ~1 min)

1. Go to https://github.com/organizations/Jax-Media-Team/repositories/new
2. Name: `cruz-golf` (or whatever final brand)
3. Visibility: **Private**
4. Skip README/.gitignore/license — already on disk
5. Click **Create repository**
6. Copy the SSH or HTTPS clone URL shown on the next page

## Step 2 — Push to GitHub (terminal, ~30 sec)

```bash
cd /c/Users/patri/Documents/golf-games-app
git remote add origin https://github.com/Jax-Media-Team/cruz-golf.git
git push -u origin main
```

If GitHub prompts for authentication, paste a Personal Access Token (Settings → Developer settings → Personal access tokens) instead of your password.

## Step 3 — Create the Supabase project (browser, ~3 min)

1. https://supabase.com → **New project**
2. Org: Jax Media Team (or personal)
3. Name: `cruz-golf-prod`
4. DB password: generate + save somewhere safe
5. Region: nearest to you (Florida → `us-east-1`)
6. Wait ~2 min for provisioning

Once it's up, **run the migrations in order** in the SQL Editor (paste each file's contents and click Run):
- `supabase/migrations/0001_init.sql`
- `supabase/migrations/0003_round_access.sql`
- `supabase/migrations/0004_invites_and_stats.sql`
- `supabase/migrations/0005_wagers_and_share.sql`
- `supabase/migrations/0006_venmo_and_avatars.sql`

Skip `0002_seed.sql` for now — we'll run it after you've signed up on the live site.

Then: **Authentication → Providers** → make sure Email is enabled. (Optional: enable Google OAuth.)

Grab API keys from **Settings → API**:
- `Project URL` → for `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public → for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` secret → for `SUPABASE_SERVICE_ROLE_KEY` *(keep secret)*

## Step 4 — Deploy to Vercel (browser, ~3 min)

1. https://vercel.com → **Add New… → Project**
2. Sign in (Jax Media Team workspace) and grant GitHub access if prompted
3. Pick the `cruz-golf` repo → **Import**
4. Framework: **Next.js** (auto-detected)
5. **Environment Variables** — add these (each as a single value):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | (from Supabase) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from Supabase) |
   | `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase, mark **Sensitive**) |
   | `OPENAI_API_KEY` | optional, enables scorecard photo OCR |
   | `APP_URL` | leave blank for first deploy |

6. Click **Deploy**. First build ~3 min.
7. Once you have the live URL (e.g. `https://cruz-golf.vercel.app`), come back and:
   - Update the `APP_URL` env var to the live URL → **Redeploy**
   - In Supabase: **Authentication → URL Configuration** → set Site URL to the Vercel URL, add `http://localhost:3000` to Redirect URLs

## Step 5 — Sign up + seed the demo data

1. Visit your live URL → **Create account** → fill in your real email + group name (e.g. "Saturday Crew")
2. Back to Supabase SQL Editor → run `supabase/migrations/0002_seed.sql`. This populates JGCC + 3 demo players + a live round + a finalized round, all linked to your profile.
3. Refresh `/dashboard` — you'll see the live round, the finalized round, and the season ledger has data.

## Step 6 — Custom domain (optional)

1. Vercel project → **Settings → Domains** → Add Domain → e.g. `cruzgolf.com`
2. Follow Vercel's DNS instructions (one CNAME or A record at your registrar)
3. Vercel auto-provisions an SSL cert in ~1 min
4. Update `APP_URL` env var to the custom domain → **Redeploy**
5. In Supabase: **Authentication → URL Configuration** → update Site URL to the custom domain

---

## Picking it up later

Everything you need to resume is on your laptop + in Git + in Supabase + in Vercel. To resume work:

```bash
cd /c/Users/patri/Documents/golf-games-app
git pull           # in case you've pushed from a different machine
npm install        # if dependencies changed
npm run dev
```

Vercel auto-deploys every push to `main`. To work on a feature without affecting prod:

```bash
git checkout -b feat/wolf-game
# ... make changes ...
git push -u origin feat/wolf-game
# Vercel auto-creates a preview URL for the branch
```

---

## Environment variables — full reference

| Var | Required | Where it's used | Secret? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | browser + server | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | browser + server | no |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-only (spectator leaderboard, OG image) | YES — never expose |
| `APP_URL` | yes | spectator share-link generation, OAuth callback | no |
| `OPENAI_API_KEY` | no (optional) | scorecard photo OCR | YES |

The dev `.env.example` reflects the same list; copy to `.env.local` for local work.

---

## Troubleshooting

- **"Insert violates row-level security policy" on signup** — RLS is fine, but a profile row needs to exist first. The signup flow upserts `profiles` for you; if you got stuck mid-signup, run `select * from public.profiles where id = auth.uid()` in SQL editor and insert manually.
- **Demo seed bails out** — the seed checks `select id from public.profiles limit 1` so you must sign up at least once before running it.
- **OG share image returns 500** — usually the `SUPABASE_SERVICE_ROLE_KEY` env var is missing in Vercel. The image route reads via the service role to bypass RLS.
- **OAuth redirect mismatch** — in Google Cloud Console, set the Authorized redirect URI to `https://<your-supabase-project>.supabase.co/auth/v1/callback`.
- **Logo not showing** — confirm `public/cruz-logo.png` exists locally and was committed (it should be — it's not in `.gitignore`).

---

## What's NOT auto-deployed

- Supabase migrations are manual. To apply a new migration to prod, paste it into the SQL editor.
- Database seed data is manual.
- DNS / domain configuration is at your registrar.

Everything else flows through Vercel on `git push origin main`.
