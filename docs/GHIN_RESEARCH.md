# GHIN / USGA handicap integration — research notes

**Status:** Research-only. Nothing is implemented or committed to. CLAUDE.md
is explicit: no fragile or non-compliant scraping, no committed fake
GHIN integration, no TOS-risk paths.

**Purpose:** Document the integration landscape so Patrick has the
realistic options laid out when the right partnership window appears.
Update this doc as the situation changes.

---

## What GHIN is (the short version)

The **GHIN** (Golf Handicap and Information Network) is the USGA's
official handicap-index service, run by the USGA. It hosts the
authoritative World Handicap System (WHS) index for U.S. amateurs.
Roughly 3M+ U.S. golfers have a GHIN number through their club. A
GHIN number is a 7- to 10-digit identifier; the index it returns
updates daily (overnight rev) based on posted scores.

Real-golf-group reality: every member-club regular has a GHIN
number. They want the app to pull the current index without re-typing
it. That's the friction we're trying to remove.

---

## The integration landscape

### What the USGA officially offers

1. **Allied Golf Association (AGA) partnership** — the canonical
   licensed path. Each state has an AGA (e.g. Florida State Golf
   Association, Southern California Golf Association). They have a
   developer program. Approval involves a written agreement,
   compliance review, and ongoing fees. AGAs vary in how
   developer-friendly they are.

2. **USGA's TOS for the public GHIN lookup page** explicitly forbids
   scraping, automated access, or re-display of index data outside
   licensed channels. The public ghin.com lookup is for human use
   only.

3. **No public REST API** is documented. The mobile apps (GHIN, USGA)
   call a private API under the hood, but those endpoints are not
   officially exposed and using them violates TOS.

### What competitors likely do

Most non-USGA-licensed apps (the small-shop scorekeeping apps that
"just work" with GHIN) fall into a few buckets — based on observed
behavior, not insider knowledge:

- **Manual lookup at signup.** User types their GHIN number once; app
  asks them to refresh manually. Lowest-friction-compliant path.
  Doesn't auto-sync.
- **Per-club / per-AGA partnership.** A handful have a license with
  a specific state AGA and use it for that state's golfers only. Slow
  geography expansion.
- **Quiet TOS violation.** Some apps reverse-engineer the private API
  and serve it as if it were licensed. This works until USGA notices
  and issues a C&D. **Not a path Cruz Golf will take** — too much
  product risk and the TOS violation undermines the trust narrative
  the app is built on.
- **GHIN-adjacent self-reporting.** Some apps don't pull GHIN at all —
  they compute their own index from scores entered in-app using the
  WHS formula. This is legal but produces a different number than
  GHIN, which confuses members who compare.

### What's realistic for Cruz Golf, in order of preference

**Tier 1 — official AGA partnership (the right answer).**
- Pick a launch AGA (Florida State Golf Association is the obvious
  start given the Jacksonville/NE-FL focus).
- Apply for their developer program. Expect:
  - Written license with use restrictions
  - Per-user or per-app fees (varies — historically $0.50-$2/user/yr
    range based on public statements, may change)
  - Audit + compliance requirements (encryption at rest, access logs)
  - Limit on how the data can be re-displayed (cannot publish a
    public leaderboard with members' GHIN indexes, for example)
- Timeline: typically 60-180 days from application to keys.
- Best path for trust + long-term durability.

**Tier 2 — manual entry with refresh prompt.**
- This is what's shipped today. `manualProvider` wraps user-entered
  indexes in a `HandicapValue` envelope. UI nudges the user to
  refresh every 30/60 days.
- Pros: zero legal risk, zero cost, ships immediately.
- Cons: friction at every refresh; members may forget; the number
  drifts from official as time passes.

**Tier 3 — direct USGA partnership.**
- Theoretically possible but harder than AGA. The USGA mostly directs
  developers to AGAs.
- Worth investigating if Cruz Golf grows beyond a single state.

**Hard NO:**
- Scraping `ghin.com/lookup`. Violates TOS. Will eventually break +
  expose the project legally.
- Reverse-engineering the mobile API. Same.
- Sharing GHIN data between groups without per-user opt-in. Privacy
  + likely TOS issue.

---

## Architectural seam (already in place)

`lib/handicap-provider.ts` defines the abstraction:

```ts
export interface HandicapProviderLookup {
  id: string;        // "manual" | "ghin" | "fsga" etc.
  label: string;
  trust: "official" | "self-reported";
  lookup(externalId: string): Promise<HandicapValue | null>;
}
```

Two providers exist:
- `manualProvider` — wraps user-entered indexes. Trust = "self-reported".
- `ghinProvider` — placeholder that returns `null`. When an AGA
  license lands, this is the single file that changes.

The **local-override always wins** safety property is enforced by
`resolveEffectiveHandicap()` + 13 regression tests in
`tests/handicap-provider.test.ts`. A commissioner's negotiated
handicap is never silently overwritten by an official refresh. This
holds whether GHIN is real or placeholder.

When GHIN lights up, the user-visible changes are minimal:
- A small "Official · GHIN" badge appears next to indexes pulled
  through the licensed channel
- A "Refresh GHIN" button on the player edit page
- The index value comes from `ghinProvider.lookup(player.ghin_number)`
  on schedule (overnight + on-demand)
- All settlement math is unchanged — handicaps flow through the same
  pipeline

---

## What I'd recommend Patrick do next (not action items — recommendations)

These are gated on Patrick's decision, not autonomous moves I'd make
without approval. GHIN sits squarely in the "GHIN/USGA/legal/TOS
concerns" carve-out Patrick called out.

1. **Apply to Florida State Golf Association's developer program.**
   They have one (last public confirmation 2024). Application is
   straightforward: name of the app, intended user base, data-handling
   summary, expected volume. Worst case: 60-day review with a "no"
   and we learn what their bar is.

2. **In parallel, draft the Cruz Golf privacy/data-handling addendum**
   that an AGA license will require. Topics:
   - Where GHIN index values are stored (Supabase Postgres, US region)
   - Who at Cruz Golf has access (platform admins + service-role on
     limited backend operations)
   - Retention (forever — historical index is part of round-record
     trust)
   - Member-controlled deletion path

3. **Don't make GHIN-blocking promises in marketing copy.** Users
   should know the manual flow is the first-class path for now. When
   GHIN lands, it's an upgrade not a fix-for-broken-behavior.

4. **Build a GHIN-import flow that ALSO works without GHIN.** Already
   done — every player has a manual `handicap_index` field. GHIN
   integration only enriches it; it never replaces or gates anything.

---

## Things to keep doing today (no GHIN required)

- Render GHIN numbers as the official identifier where they exist
  (already in `players.ghin_number`)
- Provide a "last updated" timestamp on each handicap so the user
  knows how stale it is
- Audit-log handicap changes (already covered by destructive_audit_log
  if we add a `handicap.update` kind — currently we don't, but the
  table supports it)
- Make sure the manual-entry UX is polished enough that members
  don't hate it (it's the path most of them will use for years)

---

## Open questions for when this becomes real

1. **Do we cache the GHIN index in `players` or always fetch fresh?**
   Recommended: cache in `players.handicap_official_index` +
   `handicap_official_fetched`. Refresh nightly via cron / on-demand
   via a "Refresh GHIN" button. Latency on round creation matters.

2. **What happens during a round if GHIN updates overnight?** The
   round's handicap is FROZEN at round-creation time (via
   `round_players.playing_handicap`). Even if a player's GHIN index
   updates that night, the active round uses the snapshot. This
   matches real golf: handicaps are the index at the start of play,
   not whatever they update to mid-round.

3. **Multi-jurisdiction?** A Florida player visiting Pebble Beach
   for a Cruz Golf trip. Florida AGA license; California course.
   Index lookup uses the player's home AGA (where their GHIN lives).
   Works fine.

4. **Family/junior memberships?** GHIN supports multiple indexes per
   household. Players link via their own GHIN number; the integration
   doesn't need to model households.

---

## Sources / references

- USGA WHS handbook: https://www.usga.org/handicapping/world-handicap-system-resources.html
- GHIN public lookup: https://www.ghin.com/login (note: TOS forbids
  programmatic access — this URL is for orientation only)
- AGA list: https://www.usga.org/articles/2018/09/aga-directory.html
  (the actual programs come from each AGA's website)

This doc should be reviewed annually as the AGA developer landscape
shifts.
