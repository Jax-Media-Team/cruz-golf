# Recurring friction — self-audit

**Date:** 2026-05-12
**Author:** Claude (assistant)
**Purpose:** Patrick's last directive — "I should not need to rediscover
recurring friction points manually."

This is my honest list of things Patrick has flagged across the session
that I've half-fixed, deferred, or marked "done" without walking
end-to-end. Each entry says: what Patrick said, what I actually did,
what's still open, and what the next concrete step is.

---

## 1. OCR quality (5+ surfacings)

**Patrick said:**
- "OCR identifies ZERO scores from a readable scorecard"
- "OCR is still doing a poor job pulling actual scores"
- "OCR still feels unreliable"

**What I did:**
- Removed player-list hallucination from the prompt
- Added `detail: "high"` to the API call
- Added retry on rows-but-no-cells
- Added per-cell confidence
- Added pattern detector (5 templating heuristics)
- Added suggestions panel
- Added rotate / half-crop manual escape hatches
- Added auth gate + rate limit
- Demoted to Beta + stepped loading state

**What's still open:**
The model still pattern-fills on Patrick's real card after all of
that. The Beta demotion is the correct positioning but it's not a
fix — it's an admission. The path forward is one of:
- Wait for a better vision model
- Implement structural pre-OCR (CV-based grid detection)
- Integrate a dedicated handwriting service (Mathpix, Textract)

**Next concrete step:** none from me alone. Patrick decides which of
the three to invest in. Until then, OCR stays Beta.

---

## 2. Mobile / PWA layout overlap (3 surfacings)

**Patrick said:**
- "Buttons and controls still fall off-screen in installed iPhone app mode"
- "Save buttons hidden below viewport"
- "Buttons partially off-window or hidden behind the bottom nav/home area"

**What I did:**
- Audited fixed/sticky elements (HelpButton, UpdateToast, ActiveRoundPill, demo CTA — all correct)
- Fixed GroupScorePad sticky footer (was overlapping by 1rem + safe-area)
- Confirmed body padding clears the nav on scrolling forms

**What's still open:**
I only audited the elements I could find with grep. I did NOT
walk every screen on a real iPhone PWA. The grep audit is
mechanical; Patrick's testing experience is human. The audit
agent in the first-time-user pass found additional cases:
- iPhone SE / small phones may have unique squish on signup
- Drag-and-drop on Teams section is broken on iPhone Safari
  (P0 per the audit) — this isn't safe-area, it's a different
  layout failure mode

**Next concrete step:** drag-and-drop fallback (tap-to-assign) on
Teams. Iterate on real-device feedback from Patrick — no more
"I think this is fixed."

---

## 3. Back-navigation consistency (2 surfacings)

**Patrick said:**
- "When I click into any page, there should almost always be a subtle, obvious 'Back' option"
- "Sometimes multiple back options are confusing"
- "Navigation hierarchy still inconsistent"

**What I did:**
- Removed duplicate "← Leaderboard" inside score-group's inner component
- Removed duplicate "← Back" inside score-entry's inner component

**What's still open:**
I only fixed the two cases that had a `<Link>` inside the inner
component on top of a `<RoundBreadcrumb>` at the page level. I
did NOT audit non-round pages. The first-time-user audit didn't
specifically flag this, but I should sweep:
- `/players/[id]/stats` — has its own back link?
- `/courses/[id]` — has its own back link?
- `/records/me`, `/records/course/[id]`, `/admin/*` — likely have ad-hoc back links

**Next concrete step:** grep `← ` across `app/` and reconcile every detail page to use one canonical back affordance.

---

## 4. Junk discoverability (2 surfacings)

**Patrick said:**
- "Why do I not see the trash options we discussed?" (when 0041 wasn't yet applied)
- "Why is junk not an option during initial game setup?"

**What I did:**
- Added "+ Enable junk for this round" hint card on `/rounds/[id]`
- Added "+ Other" custom-category chip in JunkControls
- Just now: added Junk toggle to `/rounds/new` form

**What's still open:**
- Saved per-round custom categories (e.g. "Blue Plate on par 5s") — not just per-item one-off labels — still deferred. Patrick mentioned this twice; I've shipped per-item custom but not per-round saved.
- Junk is now in 3 places: round-creation, games-editor, live entry. Need to verify the three configurations don't fight each other. Specifically: if user enables junk during creation with flat $2, then opens games-editor and switches to escalating $5 with different categories — does it persist correctly?

**Next concrete step:** end-to-end walk of the junk-config flow + add saved per-round custom categories.

---

## 5. Multiple paths to configure games (1 surfacing, this turn)

**Patrick said:**
- "Multiple paths to configure games creates confusion"

**What I did:**
Nothing. I haven't audited this.

**What's the actual concern:**
There are two surfaces:
- `/rounds/new` — game picker during round creation
- `/rounds/[id]/games` — games editor after the round exists

They share the same data model but different UIs and slightly
different affordances:
- The creation form has Quick-Start presets + FamilyGameRow chips
- The editor has GameCard + AddGameForm

A user who picked games at creation and then wants to change them
goes to `/games` and sees a totally different layout. That's the
"confusion."

**Next concrete step:** decide whether to unify the surfaces (use the
GameCard / AddGameForm shape in both places) or accept the divergence
and add cross-references ("Edit games" from the round page IS
already there, so cross-reference exists — the issue is visual
inconsistency, not navigation).

---

## 6. "Some flows feel like internal tooling" (1 surfacing, this turn)

**Patrick said:**
- "Some flows still feel like internal tooling"
- "Some screens still require too much interpretation"

**What I did:**
Nothing — too vague to action in isolation. But the first-time-user
audit (companion doc) identified concrete examples:

- `course-issues amber banner` on round creation: looks like an admin diagnostic, not a user message
- Settlement breakdown JSONB columns: real-engineery names leak
- "Stale player" copy in the gameErrors banner
- "minimumFlow" — fortunately doesn't leak to UI
- "fn_record_junk" / RPC errors surface raw to users in some cases

**Next concrete step:** sweep error surfaces. Wrap every Supabase
`.rpc(...)` error and `.error.message` in the existing
`friendlyAuthError()` translator or a new `friendlyRpcError()`
sibling. Audit every `setErr(error.message)` for engineer-speak.

---

## 7. First-time golfer experience (this turn — never audited before)

**Patrick said:**
- "Would 8 guys at JGCC on a Saturday actually trust and enjoy this?"
- "Please do a full first-time golfer experience audit"

**What I did:**
Just commissioned the audit (see `docs/FIRST_TIME_GOLFER_AUDIT.md`).
30 findings sorted P0/P1/P2. Top three picked.

**What's still open:**
Acting on the audit. I'm going to fix the three P0s in this turn.
The rest is on me to work through over subsequent turns, but
listing them in the audit doc so they're tracked rather than
forgotten.

**Next concrete step:** fix the three P0s — Supabase-email-name,
Teams drag-and-drop fallback, course-issues banner suppression on
verified courses.

---

## 8. Trust + confidence in scoring data (4 surfacings)

**Patrick said:**
- "Wrong scores are worse than no scores"
- "I do not want a broken 'magic' feature creating distrust"
- "OCR has a clear strategy"

**What I did:**
- Strict auto-fill rule (only high + par-plausible + pattern-clean lands in grid)
- Suggestions panel for everything else
- Per-cell visual indicators
- OCR demoted to Beta

**What's still open:**
Confidence indicators only exist on OCR'd cells. Manually-typed
scores get no provenance trail. If a user types 4 and meant 5,
there's no record of who entered what. The save-status banner
covers "did it save" but not "what changed." Score-history /
audit-trail at the cell level is the next step if Patrick wants
deeper trust.

**Next concrete step:** decide whether per-cell-edit audit is worth
the storage cost. Defer until/unless asked.

---

## 9. Stale state + caching (2 surfacings)

**Patrick said:**
- "Stale data or query mismatch" (in the junk-needs-4-players bug)
- "Stale live-round detection"

**What I did:**
- Fixed the round_players query ordering bug
- Added stale-live filter in clubhouse signal

**What's still open:**
I haven't done a query-cache audit beyond the specific cases
Patrick reported. Server-component data fetches in Next.js 15
+ Supabase are mostly fresh-on-render (force-dynamic), but
realtime subscriptions + router.refresh patterns deserve a
sweep:
- JunkControls realtime subscription was wrong (fixed)
- PressControls realtime — verified working
- Score realtime — verified
- Clubhouse signals refresh — verified
- Round-page data — re-fetched on every navigation

**Next concrete step:** none reactive. If Patrick reports more
stale-state issues, audit per case.

---

## 10. Migrations awaiting apply (2 still open)

**Status:**
- 0040 (event lifecycle RPCs) — awaiting apply since 2026-05-11.
  NOT blocking anything Patrick uses today.
- 0025, 0026, 0029, 0033 — also awaiting per the tracker, mostly
  housekeeping.

**What's still open:**
Patrick has applied 0041, 0042, 0043, 0044, 0045 since the audit
last surfaced these. The 0025-0033 chunk is older. I should look
at whether any of them are actually still pending or whether
they were applied in a batch I missed.

**Next concrete step:** ping Patrick once on the older awaiting
migrations OR audit my own tracker against `pg_proc` if I get
DB access.

---

# Summary

What I keep doing wrong:
1. Fixing the obvious case and marking the broader pattern "done."
2. Using passive language ("worth noting", "I have notes") for
   things Patrick has clearly asked me to make a call on.
3. Deferring without explicit reasoning.

What I'll change:
1. Every fix gets walked end-to-end in code AND mentally as a
   real golfer would walk it before I claim it's resolved.
2. No more "I have notes" — features get implemented OR rejected
   with reasoning, period.
3. Recurring-friction items get their own doc (this one) so I'm
   re-confronting them instead of letting them fade.

Patrick: this doc gets updated each time you flag a recurring
issue. If something here doesn't match your read of the state,
tell me which item.
