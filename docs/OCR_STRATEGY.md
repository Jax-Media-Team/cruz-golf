# OCR strategy — 2026-05-12 decision

**Status:** OCR demoted to Beta. Manual score entry is primary.
**Owner:** product
**Last revised:** 2026-05-12

Patrick (the only real-world tester) has uploaded the same handwritten
scorecard ~5 times across iterations. The pipeline has gotten more
trustworthy (auth, rate limit, pattern detector, suggestions panel,
per-player Accept-all, rotate, half-crop) but the model — gpt-4o
vision — still pattern-fills plausible-looking scores on his actual
card. The quality bar for an "OCR just works" promise is not met.

Per Patrick's directive: "I do not want a broken 'magic' feature
creating distrust."

---

## The decision

**OCR is now positioned as an experimental side path, not the primary
score-entry workflow.** Three concrete changes:

1. **The upload page is labeled "Beta · best on clean cards."** The
   page header carries the label. Users who get bad results understand
   they're on the experimental path, not the load-bearing one.

2. **Manual score entry is the primary "how do I enter scores?"
   affordance.** The round page surfaces "Enter scores" as the
   primary action; "Upload card photo" sits as a secondary text link
   beneath it with the Beta marker. Discoverable but never the first
   thing a user reaches for.

3. **Stepped loading state on the upload page.** The model call takes
   10–30 seconds; the prior "OCR in progress…" with no movement felt
   broken. Now: cycling messages ("Reading scorecard…" → "Detecting
   players…" → "Checking scores…" → "Reviewing confidence…") so the
   user can see something is happening.

---

## What we did NOT pick (and why)

- **"Hide OCR entirely":** the lucky-case wins are real. A clean
  digital scorecard photo (PDF from a tee sheet, or a scoring app
  screenshot) parses cleanly. Hiding the feature loses those.

- **"Remove OCR from the codebase":** the pattern detector, auth,
  rate limit, suggestions panel, and per-player accept-all are all
  defensive layers that genuinely help the lucky cases AND build
  the framework for a future re-promote when quality improves.
  Keeping them in tree under a Beta label is the cheapest path
  to "re-promote when the upstream model gets better."

- **"Another prompt tweak":** we've done four. Diminishing returns.
  Real improvements from here require either:
  - A better underlying model (gpt-5-vision when it ships, Claude
    vision, dedicated handwriting OCR like Mathpix / Textract)
  - Structural pre-OCR (computer-vision grid detection — find player
    rows + hole columns programmatically, OCR each cell
    independently)
  - Human-in-the-loop review-first flow (everything is a suggestion;
    nothing auto-fills)

  Each is a multi-week investment. Patrick has bigger fires.

---

## Re-promote conditions

OCR comes back to "primary path" when ANY of these is true:

1. The upstream model upgrade (next major vision release) parses
   the test card cleanly on a single attempt.
2. We implement structural pre-OCR (per-cell crops driven by grid
   detection) and it parses ≥90% of cells correctly on a real card.
3. We integrate a dedicated handwriting-OCR service (Mathpix /
   Textract / similar) that proves out in a side-by-side test.

Until then: experimental. The Beta label stays.

---

## What stays in place (defenses still useful for the lucky case)

- Auth gate + rate limit on the API endpoint (security / cost).
- Preprocess: EXIF rotation, 2400px cap, JPEG q=0.92 re-encode.
- Strict auto-fill: only high-confidence + par-plausible +
  pattern-clean cells land in the grid.
- Pattern detector: 5 templating heuristics + per-player Accept-all
  override.
- Suggestions panel with per-row Accept / Skip.
- Manual rotate-90 + half-crop escape hatches.
- Per-card diagnostics: image thumbnail, raw model output, retry
  count, attempt count, pattern warnings.
- Plain-English empty state when every row is quarantined.
- Stepped loading state (new today).

Nothing is being ripped out. The change is positioning.

---

## What changes for the user

| Surface | Before | After |
|---|---|---|
| Round page | "Upload card photo" as a peer to other quick actions | "Enter scores" primary; "Upload card photo (Beta)" as a small secondary link |
| Upload page header | "Upload scorecard photos" | "Upload scorecard photos · Beta — best on clean cards" |
| Upload page intro copy | "Snap a photo and we'll OCR it" | Explicit "OCR is experimental — manual entry is faster + more reliable. Best results when the card is flat, well-lit, and not handwritten in cursive." |
| Loading state during OCR | "OCR in progress…" (static) | Cycling: "Preparing image…" → "Reading scorecard…" → "Detecting players…" → "Checking scores…" → "Reviewing confidence…" |
| When OCR returns mostly suggestions | Plain-English empty state explaining options | Same, plus a "Type scores instead" CTA links straight to the manual surface |

---

## Reversal plan

When OCR quality crosses the re-promote threshold, the changes
needed to reverse this decision are small:

1. Remove the "· Beta" suffix from upload page header.
2. Remove the "OCR is experimental" intro paragraph.
3. Promote "Upload card photo" back to peer-level on the round page.
4. Update the dashboard onboarding to mention OCR as an option.

About 30 minutes of work. The infrastructure stays.
