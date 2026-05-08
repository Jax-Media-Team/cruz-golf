# Integrations & API plan

## GHIN (USGA Handicap System)

**There is no public, generally-available GHIN API.** The USGA's Golfer Product Access (GPA) program is the only sanctioned developer pathway, and it is restricted to approved technology vendors who meet contract, security, and use-case requirements. Reverse-engineered or scraped access violates USGA terms of service and risks both blocked access and legal exposure.

This app **does not** scrape GHIN. The handicap pipeline is built so that any of the following sources can fill the `players.handicap_index` field through a single adapter:

```ts
interface HandicapSource {
  name: "manual" | "self" | "admin" | "gpa";
  fetchIndex(player: Player): Promise<{ index: number, asOf: Date } | null>;
}
```

Default adapters shipped:
- `manual` — commissioner enters/updates the index.
- `self` — player updates their own profile.
- `admin` — commissioner override on a specific round (does not touch the player profile).

Future adapter (gated behind GPA approval):
- `gpa` — real handicap fetch via authorized GHIN endpoints.

**Recommended workflow**: when a player has a GHIN number on file, the player profile shows a "Refresh from GHIN.com" link that opens `https://www.ghin.com/golfer-lookup` in a new tab. The user reads off the current Handicap Index and types it in. Friction-free enough to use weekly, fully compliant.

## Course rating / slope / par data

The USGA's National Course Rating Database (`ncrdb.usga.org`) is publicly accessible as a web UI but does not expose a public REST API. Options:

1. **Manual entry (default)** — the course wizard lets commissioners enter rating/slope/par per tee + hole pars + stroke indexes. Once entered, courses are reusable forever.
2. **`usga_course_id`** — when a commissioner enters a course, they can store the NCRDB course id; the UI then deep-links to the course's NCRDB page so updated values can be re-typed when the course re-rates.
3. **Third-party licensed APIs** (paid, optional) — the codebase has a `CourseDataSource` adapter so `golfapi.io`, `golf-course-database.com`, etc. can be wired in if you want to pre-populate.

```ts
interface CourseDataSource {
  search(q: string): Promise<CourseSearchResult[]>;
  fetchCourse(id: string): Promise<CourseFull>;
}
```

Shipped: `manual`. The `golfapi_io` and `gcdb` adapters are left as TODOs with the right shape.

## OCR for scorecard photos

The Score Card Upload flow (see PRD §Scorecard photo upload) accepts a phone photo and returns a hole-by-hole gross map per player. Implementation is pluggable:

```ts
interface ScorecardOCR {
  parse(image: Buffer | Blob, hint: { players: string[], holes: 9 | 18 }):
    Promise<{ players: Array<{ name: string, scores: (number | null)[] }> }>;
}
```

Default adapter: **OpenAI gpt-4o vision** via the standard chat completions endpoint with a strongly-structured JSON schema response. Costs roughly a few cents per card. Set `OPENAI_API_KEY` in `.env.local` to enable; without it, the upload screen still works but parses to all-null and asks the user to type values into a paper-card-style grid (still better than nothing).

Alternative adapter: **Tesseract.js**, fully local, free, but needs a clean photo. Provided as `lib/ocr/tesseract.ts` — wire it in by changing the export in `lib/ocr/index.ts`.

The OCR result is **never** auto-saved. The upload flow always shows a review screen requiring user confirmation. This is also an injection-defense measure (an OCR'd image cannot inject instructions into our app).

## Notifications

Out of scope for MVP. V2 plan: Supabase trigger → edge function → SMS via Twilio for "your turn to keep score" / "round finalized" / "you owe $X". Built behind a feature flag.

## Auth

Supabase Auth, email + password by default, magic link as a fallback. Per-group access is enforced by RLS. No social login (keeps the surface area small).

## Realtime

Supabase Realtime via Postgres replication on the `scores` and `manual_entries` tables. The `/rounds/[id]` route subscribes to changes and re-derives projections client-side for instant updates.

## Storage

Supabase Storage bucket `scorecards` (private). Signed URLs for round participants only.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=          # optional, enables OCR
APP_URL=                 # used to build spectator share links
```

## Compliance summary

- No scraping of GHIN, USGA, or any other site.
- All third-party data sources used only via licensed/authorized APIs.
- User-supplied data only; no auto-discovery from external sites without explicit user action (typing in a number after looking it up themselves does not constitute scraping).
- Course rating data entered by users is stored as their own data (with attribution to its source) and is not redistributed publicly.
