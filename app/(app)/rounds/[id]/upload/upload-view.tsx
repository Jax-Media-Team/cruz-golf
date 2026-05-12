"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { PhotoPicker } from "@/components/PhotoPicker";
import { bestMatch } from "@/lib/ocr/name-match";
import { prepareImageForOCR, type PrepareImageResult } from "@/lib/ocr/preprocess";
import {
  detectSuspiciousPatterns,
  type PatternWarning
} from "@/lib/ocr/pattern-checks";
import { rotateImage90, cropImage } from "@/lib/ocr/transform";

type Card = {
  id: string;
  filename: string;
  status: "uploading" | "parsed" | "failed";
  err?: string;
  rows?: Array<{ name: string; scores: Array<number | null> }>;
  /** Total non-null cells parsed across all player rows on this card. */
  score_count?: number;
  /** Total cells the card SHOULD have (rows × holes). */
  cells_total?: number;
  /** Data URL of the uploaded image — retained for the diagnostics
   *  panel thumbnail and for the "Retry OCR" path so we don't need
   *  the user to re-pick the file. */
  data_url?: string;
  /** Diagnostics from the OCR endpoint (raw model text + pre/post
   *  coerce shapes + image / model meta). Surfaced in a collapsible
   *  panel for "where did the scores get lost" debugging. */
  debug?: {
    raw_text: string;
    pre_coerce: any;
    post_coerce: any;
    data_url_bytes?: number;
    model?: string;
    called_at?: string;
    no_player_hint?: boolean;
    /** Number of upstream API calls — 2 means we auto-retried on
     *  the "rows but no scores" failure mode. */
    attempts?: number;
    /** When auto-retried, the first attempt's raw text — so we can
     *  see WHAT the model returned that triggered the retry. */
    first_attempt_raw?: string;
  };
  /** Per-row outcome captured during the merge step — what the score
   *  count was, who it matched, why it was dropped if unmatched.
   *  Used by the diagnostics panel so failure modes are legible. */
  row_outcomes?: Array<{
    ocr_name: string;
    scores_parsed: number;
    matched_to: string | null;
    match_score: number;
    outcome: "merged" | "unmatched_panel" | "dropped_no_name_no_scores";
  }>;
  /** True when this card has been retried at least once. Used to dim
   *  the Retry button after one attempt and surface "retry count" in
   *  the diagnostics panel. */
  retry_count?: number;
  /** Timestamp (ms since epoch) when the current OCR call started.
   *  Used by the stepped loading state to cycle progress messages
   *  ("Preparing image…" → "Reading scorecard…" → …). Cleared when
   *  the call returns. */
  uploading_started_at?: number;
  /** Client-side preprocessing diagnostic — source size, scaling
   *  applied, output bytes. Surfaced in the diagnostics panel so
   *  "did EXIF rotation apply / was it downscaled?" is answerable. */
  preprocess?: PrepareImageResult;
  /** Pattern-detector warnings (row duplicated across players,
   *  matches par, low variance, front=back, uniform value).
   *  Stashed so the diagnostics panel can render them per card. */
  pattern_warnings?: PatternWarning[];
};

/**
 * Per-cell provenance + confidence + suspicious-vs-par status.
 *
 * Updated 2026-05-12 (Patrick's review-first directive): nothing
 * lands in the grid silently. All OCR cells flow through the
 * suggestions panel; the `ocr_*` sources are stamped only when the
 * user EXPLICITLY accepts a suggestion. Provenance survives
 * acceptance so a user reviewing the grid later can still see which
 * cells came from a card photo vs which they typed by hand.
 *
 *   - "db"             — already in the DB before upload (blue tint)
 *   - "ocr_high"       — user accepted from a high-confidence OCR read
 *                        (full-opacity amber border)
 *   - "ocr_low"        — user accepted from a low-confidence OCR read
 *                        (dashed amber border — visible reminder that
 *                        the model wasn't sure)
 *   - "ocr_suspicious" — user accepted from an OCR read that was
 *                        either way-off-par or in a templated-row
 *                        pattern. Red ring to keep the warning visible
 *                        even after acceptance.
 *   - "manual"         — user typed directly (no marker)
 *   - null             — empty cell
 *
 * Order of operations on an OCR card upload:
 *   1. Model returns per-cell value + confidence.
 *   2. Each cell is tier-classified: high+plausible+pattern-clean,
 *      low-confidence, way-off-par, pattern-quarantined.
 *   3. Every non-null cell becomes a Suggestion entry. None land
 *      in the grid yet.
 *   4. User clicks "Accept all clear reads" OR "Accept all for [name]"
 *      OR per-cell ✓. On accept, the cell's CellSource is stamped
 *      per its tier (high → ocr_high, low → ocr_low, suspicious /
 *      pattern → ocr_suspicious).
 *   5. The grid renders per the final source label.
 */
type CellSource =
  | "db"
  | "ocr_high"
  | "ocr_low"
  | "ocr_suspicious"
  | "manual"
  | null;

type GridRow = {
  round_player_id: string;
  name: string;
  /** scores indexed 0..holes-1; null = no value yet */
  scores: Array<number | null>;
  /** Per-cell provenance — so OCR'd cells can be visually marked for review. */
  sources: Array<CellSource>;
  /** Where this row's scores came from (filenames). Empty = manual. */
  source_filenames: string[];
};

/**
 * Decide whether an OCR value is "suspicious" given the hole's par.
 * A score outside [1, par + 5] is almost certainly a misread or a
 * disaster the user will want to verify. Returns true when suspicious.
 */
function isSuspiciousVsPar(score: number, par: number): boolean {
  return score < 1 || score > par + 5;
}

/**
 * Multi-scorecard upload + review.
 *
 * - Accept multiple files in one go (e.g., one card per foursome on an 8-player round)
 * - OCR each in parallel; show per-card status
 * - Merge OCR results into one grid keyed by player; if multiple cards have
 *   scores for the same player, later cards overwrite per-cell, but rows
 *   stay distinct visually with source-card indicators
 * - Editable cells before saving
 * - Confirms before overwriting existing DB scores on save
 * - Manual mode: skip uploads, show empty grid for hand-fill
 */
export function UploadView({
  roundId,
  holes,
  players,
  holePars
}: {
  roundId: string;
  holes: 9 | 18;
  players: Array<{ round_player_id: string; name: string }>;
  /** Par per hole, length === holes. Used for par-suspicious cell
   *  validation. Falls back to par 4 for missing entries (handled
   *  in the parent route). */
  holePars: number[];
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [grid, setGrid] = useState<GridRow[]>(() =>
    players.map((p) => ({
      round_player_id: p.round_player_id,
      name: p.name,
      scores: new Array(holes).fill(null),
      sources: new Array<CellSource>(holes).fill(null),
      source_filenames: []
    }))
  );
  const [existingByPlayer, setExistingByPlayer] = useState<Record<string, Set<number>>>({});
  // OCR rows we couldn't auto-match to a round player. Surfaced as a
  // "Map these rows" panel — the user picks the right player from a
  // dropdown and the scores merge into the grid. This was the major
  // dead-end before: rows that didn't fuzzy-match were silently
  // dropped, so a card with "Pat" couldn't reach "Patrick Cruz".
  type UnmatchedRow = {
    id: string;
    /** Stable card id this row came from. Stored explicitly because
     *  the prior approach (`u.id.split("-")[0]`) returned the literal
     *  string "c" — card ids are `c-<timestamp>-<idx>`, so splitting
     *  on "-" loses the timestamp. That broke retry / removeCard
     *  state cleanup. Bug caught in code review 2026-05-12. */
    card_id: string;
    ocr_name: string;
    scores: Array<number | null>;
    /** Parallel to scores. "high" / "low" / null. Carried so when the
     *  user maps the row, the merge writes the right CellSource. */
    confidences: Array<"high" | "low" | null>;
    /** True when the parent OCR row tripped a pattern check. Carried
     *  forward so the unmatched-merge path applies the same
     *  suggestion-only treatment as matched rows. */
    pattern_warned: boolean;
    /** Suggested round_player_id from bestMatch (may be null). */
    suggested_rp_id: string | null;
    suggested_score: number; // bestMatch score, 0-100
    filename: string;
  };
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);

  // Tick once per second while any card is uploading so the
  // stepped-progress text re-renders. Idle when no card is in
  // flight — interval clears.
  const [, setTick] = useState(0);
  const anyUploading = cards.some((c) => c.status === "uploading");
  useEffect(() => {
    if (!anyUploading) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyUploading]);

  function ocrProgressMessage(startedAt: number | undefined): string {
    if (startedAt == null) return "OCR in progress…";
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed < 2) return "Preparing image…";
    if (elapsed < 8) return "Reading scorecard…";
    if (elapsed < 16) return "Detecting players…";
    if (elapsed < 24) return "Checking scores…";
    if (elapsed < 32) return "Reviewing confidence…";
    return `Still working (${Math.round(elapsed)}s)…`;
  }

  /**
   * A per-cell OCR suggestion. Lives in the "Review suggestions"
   * panel below the grid. User accepts or skips each — on accept the
   * cell is stamped per its OCR tier (ocr_high / ocr_low /
   * ocr_suspicious) so provenance survives the explicit accept
   * (Patrick 2026-05-12 review-first directive).
   */
  type Suggestion = {
    id: string;
    card_id: string;
    round_player_id: string;
    player_name: string;
    /** 0-indexed hole number. */
    hole_index: number;
    value: number;
    confidence: "high" | "low" | null;
    /** Why this didn't auto-fill — shown on the row as chips. */
    reasons: string[];
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Pull existing scores once on mount so we can warn if uploads would overwrite.
  useEffect(() => {
    (async () => {
      const rpIds = players.map((p) => p.round_player_id);
      if (rpIds.length === 0) return;
      const { data } = await sb
        .from("scores")
        .select("round_player_id, hole_number, gross")
        .in("round_player_id", rpIds);
      const map: Record<string, Set<number>> = {};
      for (const s of (data as any[]) ?? []) {
        if (s.gross == null) continue;
        const set = map[s.round_player_id] ?? new Set<number>();
        set.add(s.hole_number);
        map[s.round_player_id] = set;
      }
      setExistingByPlayer(map);
      // Pre-fill the grid with existing scores so we don't mistakenly drop them.
      setGrid((prev) =>
        prev.map((row) => {
          const filled = (data as any[])?.filter((s) => s.round_player_id === row.round_player_id) ?? [];
          if (filled.length === 0) return row;
          const next = [...row.scores];
          const sources = [...row.sources];
          for (const s of filled) {
            if (s.gross != null && s.hole_number >= 1 && s.hole_number <= holes) {
              next[s.hole_number - 1] = s.gross;
              sources[s.hole_number - 1] = "db";
            }
          }
          return { ...row, scores: next, sources };
        })
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Core OCR-and-merge pipeline. Extracted from `onFiles` so we can
   * re-run it for a Retry from the diagnostics panel without making
   * the user re-pick the file. Idempotent on the grid: per-cell merge
   * with "OCR value wins if non-null".
   *
   * Concurrency guard: a ref-based in-flight set. Two rapid taps on
   * Retry / Rotate / Crop on mobile can fire two near-simultaneous
   * calls before React's state update changes the button visibility
   * (the buttons are gated on `card.status === "parsed"`, which
   * doesn't flip until setCards lands). The ref short-circuits the
   * second call so prior + new state writes don't interleave.
   */
  const inFlightCardsRef = useRef<Set<string>>(new Set());

  async function runOcrOnCard(
    cardId: string,
    filename: string,
    dataUrl: string
  ) {
    if (inFlightCardsRef.current.has(cardId)) return;
    inFlightCardsRef.current.add(cardId);
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? {
              ...c,
              status: "uploading",
              err: undefined,
              uploading_started_at: Date.now()
            }
          : c
      )
    );
    try {
      const r = await fetch("/api/scorecard-ocr", {
        method: "POST",
        body: JSON.stringify({ dataUrl, holes })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "OCR failed");
      const rows = (j.players ?? []) as Array<{
        name: string;
        scores: Array<number | null>;
        confidences?: Array<"high" | "low" | null>;
      }>;
      const score_count = rows.reduce(
        (sum, p) => sum + p.scores.filter((s) => s != null).length,
        0
      );
      const cells_total = rows.length * holes;
      const debug = (j._debug ?? undefined) as Card["debug"];
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: "parsed",
                rows,
                score_count,
                cells_total,
                debug,
                data_url: dataUrl
              }
            : c
        )
      );
      // Merge into grid: for each parsed row, find the best-
      // scoring matching player via bestMatch (handles initials,
      // comma-reversed names, nickname → full-name, etc.). Per-cell
      // overwrite if the OCR cell has a value. Unmatched rows go
      // into the `unmatched` list with a "Map to:" dropdown — the
      // user resolves them manually instead of losing the scores.
      const roundPlayerCandidates = players.map((p) => ({
        round_player_id: p.round_player_id,
        name: p.name
      }));
      const matchAssignments = new Map<string, number>(); // rp_id → row index
      rows.forEach((row, rowIdx) => {
        const best = bestMatch(row.name, roundPlayerCandidates);
        if (best) matchAssignments.set(best.round_player_id, rowIdx);
      });

      // Pattern detection — runs on the model's raw rows BEFORE any
      // merge. Catches the failure mode Patrick caught in real-world
      // testing: the model emits a plausible-looking score sequence
      // (5,4,4,3,5,4,...) that doesn't match the card. Quarantined
      // rows have their cells downgraded to suggestion-only (they
      // do NOT auto-fill the grid).
      const patternResult = detectSuspiciousPatterns({
        rows: rows.map((r) => ({ name: r.name, scores: r.scores })),
        pars: holePars
      });
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? { ...c, pattern_warnings: patternResult.warnings }
            : c
        )
      );

      // Per Patrick 2026-05-12: OCR is ASSISTIVE, not automatic.
      // NOTHING lands in the grid without an explicit user accept —
      // even high-confidence cells. The model can confidently
      // misread (templating, gross/net notation, circles/slashes
      // mistaken for digits) and silently corrupting a scorecard
      // is worse than no OCR at all. The grid stays untouched on
      // upload; every non-null OCR value flows to the suggestions
      // panel where the user accepts in bulk ("Accept all
      // high-confidence reads") or one-by-one.
      //
      // We still record the source_filename so the upload card
      // shows "card-3.jpg → 7 suggestions for Patrick" rather than
      // "card-3.jpg processed (no effect)".
      setGrid((prev) =>
        prev.map((row) => {
          const matchedIdx = matchAssignments.get(row.round_player_id);
          if (matchedIdx == null) return row;
          const sources = row.source_filenames.includes(filename)
            ? row.source_filenames
            : [...row.source_filenames, filename];
          return { ...row, source_filenames: sources };
        })
      );

      // Build suggestions for every OCR cell that matched a round
      // player. Each suggestion carries its confidence class so the
      // panel can render high / uncertain / suspicious tiers and the
      // bulk action can target only the high-confidence subset.
      const newSuggestions: Suggestion[] = [];
      for (const [rpId, rowIdx] of matchAssignments) {
        const match = rows[rowIdx];
        const matchConfidences = match.confidences ?? [];
        const rowQuarantined =
          patternResult.rows_to_quarantine.has(rowIdx);
        const matchedRp = players.find(
          (p) => p.round_player_id === rpId
        );
        match.scores.forEach((ocrVal, holeIdx) => {
          if (ocrVal == null) return;
          const par = holePars[holeIdx] ?? 4;
          const suspicious = isSuspiciousVsPar(ocrVal, par);
          const c = matchConfidences[holeIdx];
          const reasons: string[] = [];
          if (c !== "high") reasons.push("model is uncertain");
          if (suspicious) reasons.push(`way off par (${par})`);
          if (rowQuarantined) reasons.push("row matches a suspicious pattern");
          newSuggestions.push({
            id: `${cardId}-${rowIdx}-${holeIdx}`,
            card_id: cardId,
            round_player_id: rpId,
            player_name: matchedRp?.name ?? "Player",
            hole_index: holeIdx,
            value: ocrVal,
            confidence: c ?? null,
            reasons
          });
        });
      }
      // Replace any prior suggestions for this card (a Retry should
      // refresh, not duplicate).
      setSuggestions((prev) => [
        ...prev.filter((s) => s.card_id !== cardId),
        ...newSuggestions
      ]);

      // Drop any unmatched rows previously captured for THIS card —
      // a retry should replace them, not duplicate.
      setUnmatched((prev) => prev.filter((u) => u.card_id !== cardId));

      const matchedRowIndexes = new Set(matchAssignments.values());
      const newUnmatched: UnmatchedRow[] = [];
      const rowOutcomes: NonNullable<Card["row_outcomes"]> = [];
      rows.forEach((row, idx) => {
        const scoreCount = row.scores.filter((s) => s != null).length;
        const best = bestMatch(row.name, roundPlayerCandidates);

        if (matchedRowIndexes.has(idx)) {
          let matchedRpId: string | null = null;
          for (const [rpId, assignedIdx] of matchAssignments) {
            if (assignedIdx === idx) {
              matchedRpId = rpId;
              break;
            }
          }
          const matchedRp = players.find(
            (p) => p.round_player_id === matchedRpId
          );
          rowOutcomes.push({
            ocr_name: row.name || `Row ${idx + 1}`,
            scores_parsed: scoreCount,
            matched_to: matchedRp?.name ?? null,
            match_score: best?.score ?? 0,
            outcome: "merged"
          });
          return;
        }
        if (!row.name && scoreCount === 0) {
          rowOutcomes.push({
            ocr_name: row.name || `Row ${idx + 1}`,
            scores_parsed: 0,
            matched_to: null,
            match_score: 0,
            outcome: "dropped_no_name_no_scores"
          });
          return;
        }
        rowOutcomes.push({
          ocr_name: row.name || `Row ${idx + 1}`,
          scores_parsed: scoreCount,
          matched_to: null,
          match_score: best?.score ?? 0,
          outcome: "unmatched_panel"
        });
        newUnmatched.push({
          id: `unmatched-${cardId}-r${idx}`,
          card_id: cardId,
          ocr_name: row.name || `Row ${idx + 1}`,
          scores: row.scores,
          confidences:
            row.confidences ??
            row.scores.map((s) => (s == null ? null : "low")),
          pattern_warned: patternResult.rows_to_quarantine.has(idx),
          suggested_rp_id: best?.round_player_id ?? null,
          suggested_score: best?.score ?? 0,
          filename
        });
      });
      if (newUnmatched.length > 0) {
        setUnmatched((prev) => [...prev, ...newUnmatched]);
      }
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId ? { ...c, row_outcomes: rowOutcomes } : c
        )
      );
    } catch (e: any) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? { ...c, status: "failed", err: e?.message ?? "OCR failed" }
            : c
        )
      );
    } finally {
      inFlightCardsRef.current.delete(cardId);
    }
  }

  async function onFiles(files: FileList | File[]) {
    setErr(null);
    const list = Array.from(files);
    if (list.length === 0) return;
    const startCount = cards.length;
    const newCards: Card[] = list.map((f, i) => ({
      id: `c-${Date.now()}-${startCount + i}`,
      filename: f.name,
      status: "uploading"
    }));
    setCards((prev) => [...prev, ...newCards]);

    await Promise.all(
      list.map(async (file, i) => {
        const cardId = newCards[i].id;
        // Client-side preprocessing: EXIF auto-rotate + cap long-side
        // at 2400px. iPhone photos are typically 4032px wide and
        // rotated — without this, gpt-4o either sees a sideways
        // image OR pays for downsampling its own server-side. The
        // preprocess metadata lands on the card for diagnostics.
        const prep = await prepareImageForOCR(file);
        setCards((prev) =>
          prev.map((c) =>
            c.id === cardId ? { ...c, preprocess: prep } : c
          )
        );
        await runOcrOnCard(cardId, file.name, prep.dataUrl);
      })
    );
  }

  /**
   * Drop a card from the list — and any unmatched rows it produced.
   * The grid itself is NOT touched: if the user already merged some
   * OCR'd cells into the grid and then changes their mind about the
   * card, the cells they edited stay. They can clear individual cells
   * manually. This matches the "salvage, don't lose work" principle.
   */
  function removeCard(cardId: string) {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setUnmatched((prev) => prev.filter((u) => u.card_id !== cardId));
    setSuggestions((prev) => prev.filter((s) => s.card_id !== cardId));
  }

  /**
   * Re-run OCR on a card the user already uploaded. Useful when the
   * first parse came back empty — gpt-4o can be non-deterministic on
   * difficult cards even at temperature=0, and a single retry often
   * recovers. We also use this as the "rescan after deploy" path —
   * when the prompt changes, an unhappy parse can be fixed without
   * the user re-picking the file.
   */
  async function retryCard(cardId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card?.data_url) return;
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, retry_count: (c.retry_count ?? 0) + 1 }
          : c
      )
    );
    await runOcrOnCard(cardId, card.filename, card.data_url);
  }

  /**
   * Rotate the card image by 90° clockwise + re-OCR. Patrick's
   * real-world test had a sideways card (landscape photographed
   * while phone was portrait). The model performs much worse when
   * the card is oriented wrong — rotating fixes it. Repeated taps
   * cycle 90 → 180 → 270 → 0.
   *
   * Also clears any pending suggestions for that card so the new
   * OCR pass replaces them.
   */
  async function rotateCard(cardId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card?.data_url) return;
    try {
      const rotated = await rotateImage90(card.data_url, 1);
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                data_url: rotated,
                retry_count: (c.retry_count ?? 0) + 1
              }
            : c
        )
      );
      setSuggestions((prev) => prev.filter((s) => s.card_id !== cardId));
      await runOcrOnCard(cardId, card.filename, rotated);
    } catch (e: any) {
      setErr(`Couldn't rotate this card: ${e?.message ?? "unknown"}`);
    }
  }

  /**
   * Crop the card to one half (top / bottom / left / right) + re-OCR.
   * Patrick asked for "consider front-nine/back-nine crop prompts" —
   * this is the simplest version that ships today without a
   * draggable-rectangle UI. Most scorecards have the front 9 on one
   * half and back 9 on the other; cropping eliminates the cross-half
   * templating risk for one half at a time.
   *
   * The user runs the OCR a second time on the OTHER half to get all
   * 18 holes. Merging is the default behavior of runOcrOnCard
   * (per-cell highs land in the grid; the rest become suggestions).
   */
  async function cropAndRetry(
    cardId: string,
    region: "top" | "bottom" | "left" | "right"
  ) {
    const card = cards.find((c) => c.id === cardId);
    if (!card?.data_url) return;
    const rect =
      region === "top"
        ? { x: 0, y: 0, w: 1, h: 0.55 }
        : region === "bottom"
        ? { x: 0, y: 0.45, w: 1, h: 0.55 }
        : region === "left"
        ? { x: 0, y: 0, w: 0.55, h: 1 }
        : { x: 0.45, y: 0, w: 0.55, h: 1 };
    try {
      const cropped = await cropImage(card.data_url, rect);
      // Don't overwrite the source data_url — the user may want to
      // try a different crop. Just re-OCR with the cropped image.
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                retry_count: (c.retry_count ?? 0) + 1
              }
            : c
        )
      );
      setSuggestions((prev) => prev.filter((s) => s.card_id !== cardId));
      await runOcrOnCard(cardId, card.filename, cropped);
    } catch (e: any) {
      setErr(`Couldn't crop this card: ${e?.message ?? "unknown"}`);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);

    // Detect overwrites of existing values that the user kept (or that came
    // from OCR). We only confirm when we're about to OVERWRITE an existing
    // server-side cell with a DIFFERENT value.
    const overwrites: Array<{ name: string; hole: number }> = [];
    for (const row of grid) {
      const ex = existingByPlayer[row.round_player_id];
      if (!ex) continue;
      row.scores.forEach((v, i) => {
        const hole = i + 1;
        if (v != null && ex.has(hole)) {
          // We had an existing value; check if it'd be overwritten with a
          // different number. Without round-tripping the existing value here
          // (we already merged it into the grid on mount), this signals
          // "row touched cells that existed". Conservative: just warn.
          overwrites.push({ name: row.name, hole });
        }
      });
    }
    if (overwrites.length > 0) {
      const ok = confirm(
        `This save will write to ${overwrites.length} existing cell${overwrites.length === 1 ? "" : "s"}. Continue?`
      );
      if (!ok) {
        setBusy(false);
        return;
      }
    }

    const { data: userData } = await sb.auth.getUser();
    const inserts: any[] = [];
    for (const row of grid) {
      row.scores.forEach((g, i) => {
        if (g != null) {
          inserts.push({
            round_player_id: row.round_player_id,
            hole_number: i + 1,
            gross: g,
            updated_by: userData.user?.id ?? null,
            updated_at: new Date().toISOString()
          });
        }
      });
    }
    if (inserts.length === 0) {
      setBusy(false);
      setErr(
        "Add at least one score before saving — type values in the grid below, or upload a scorecard photo above."
      );
      return;
    }
    const { error } = await sb
      .from("scores")
      .upsert(inserts, { onConflict: "round_player_id,hole_number" });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    router.push(`/rounds/${roundId}`);
  }

  function setCell(rowIdx: number, holeIdx: number, value: number | null) {
    setGrid((prev) =>
      prev.map((row, i) =>
        i === rowIdx
          ? {
              ...row,
              scores: row.scores.map((s, j) => (j === holeIdx ? value : s)),
              // Manual edit flips this cell's source to "manual" so the
              // OCR-highlight goes away after the user touches it.
              sources: row.sources.map((src, j) =>
                j === holeIdx ? (value == null ? null : "manual") : src
              )
            }
          : row
      )
    );
  }

  // OCR no-op detection. The OCR endpoint returns a sentinel string in
  // _debug.raw_text when OPENAI_API_KEY isn't set on the deployment.
  // If we see that on any uploaded card, the whole upload surface is
  // effectively broken — bump a banner to the top so the user doesn't
  // think their image was bad.
  const ocrNoop = cards.some((c) =>
    c.debug?.raw_text?.startsWith("OPENAI_API_KEY is not set")
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <header className="space-y-2">
        <p className="h-eyebrow">Card upload</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1 flex items-center gap-2 flex-wrap">
          <span>Upload scorecard photos</span>
          <span className="text-[10px] uppercase tracking-[0.22em] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30 align-middle font-sans">
            Beta
          </span>
        </h1>
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-xs text-cream-100/85 space-y-1 leading-snug">
          <p>
            <span className="font-medium text-amber-200">OCR is assistive, not automatic.</span>{" "}
            We read your card and surface every cell as a{" "}
            <span className="text-cream-50">suggestion</span> below the
            grid — nothing lands in your scorecard until you accept it.
            Works best on flat, well-lit, machine-printed or cleanly-
            handwritten cards. Cursive, gross/net notation, and circles
            often misread.
          </p>
          <p className="text-cream-100/65">
            For most rounds, typing scores by hand on the round page
            is faster and more reliable. This page is here for the
            lucky-card cases — if it doesn&apos;t work,{" "}
            <Link
              href={`/rounds/${roundId}/score-group`}
              className="text-gold-400 hover:underline"
            >
              type scores instead →
            </Link>
          </p>
        </div>
      </header>

      {ocrNoop && (
        <div className="card p-4 border border-red-400/40 bg-red-500/10 space-y-1.5">
          <p className="font-medium text-red-200">
            Scorecard OCR is disabled on this deployment.
          </p>
          <p className="text-xs text-red-100/85 leading-snug">
            The server is missing the{" "}
            <code className="font-mono text-red-100">OPENAI_API_KEY</code> env
            var, so every upload returns empty scores. You can still type
            scores by hand in the grid below — but the AI parse won&apos;t
            work until an admin adds the key in Vercel and redeploys.
          </p>
          <p className="text-[11px] text-red-100/70 leading-snug">
            Admins: see <code className="font-mono">/admin/diagnostics</code> for
            the full env-var status of this deployment.
          </p>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div>
          <p className="label text-xs">Add photo(s)</p>
          <p className="text-[11px] text-cream-100/55 mt-0.5 mb-2">
            Take a fresh photo or choose a saved scorecard from your library
            — screenshots and texted images work too.
          </p>
          <PhotoPicker onFiles={onFiles}>
            {({ openCamera, openLibrary }) => (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  className="btn-secondary text-sm"
                >
                  📸 Take photo
                </button>
                <button
                  type="button"
                  onClick={openLibrary}
                  className="btn-ghost text-sm"
                >
                  🖼 Choose from library
                </button>
              </div>
            )}
          </PhotoPicker>
        </div>

        {cards.length > 0 && (
          <ul className="text-xs space-y-1.5">
            {cards.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-cream-100/85 truncate flex-1 min-w-0">
                    {c.filename}
                  </span>
                  <span
                    className={`shrink-0 ${
                      c.status === "uploading"
                        ? "text-cream-100/55"
                        : c.status === "failed"
                        ? "text-red-300"
                        : "text-emerald-300"
                    }`}
                  >
                    {c.status === "uploading"
                      ? ocrProgressMessage(c.uploading_started_at)
                      : c.status === "failed"
                      ? `Failed: ${c.err ?? ""}`
                      : (() => {
                          const players = c.rows?.length ?? 0;
                          const cells = c.score_count ?? 0;
                          const cellsTotal = c.cells_total ?? 0;
                          if (cells === 0) {
                            return `Parsed ${players} player${players === 1 ? "" : "s"} · no scores read — see diagnostics`;
                          }
                          const pct = cellsTotal > 0 ? Math.round((cells / cellsTotal) * 100) : 0;
                          return `Read ${cells} of ${cellsTotal} cells (${pct}%) · review highlighted cells`;
                        })()}
                  </span>
                  {c.status !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => removeCard(c.id)}
                      className="shrink-0 text-cream-100/45 hover:text-red-300 transition-colors px-1.5"
                      aria-label={`Remove ${c.filename} from upload list`}
                      title="Remove this card. Already-merged cells stay in the grid below — you can clear them manually if you don't want them."
                    >
                      ✕
                    </button>
                  )}
                </div>
                {/* Diagnostics — collapsible per-card. Patrick asked
                    to see EXACTLY where scores get lost. We expose:
                    1) per-row outcomes (merged / mapping panel /
                       dropped), with match score
                    2) the raw model text — so a "model returned
                       all nulls" failure is legible
                    Always shown for parsed/failed cards; the
                    diagnostics state is captured on every OCR call.
                */}
                {(c.status === "parsed" || c.status === "failed") &&
                  (c.row_outcomes || c.debug || c.data_url) && (
                    <details className="text-[11px] text-cream-100/65 pl-3 border-l border-cream-100/10">
                      <summary className="cursor-pointer hover:text-cream-100/85 select-none">
                        Diagnostics — what the OCR saw
                      </summary>
                      <div className="mt-2 space-y-2 pl-2">
                        {/* Image thumbnail + meta + retry. The
                            thumbnail is the most-requested feature
                            from real-world testing — when the model
                            returns garbage, you want to verify the
                            image actually arrived at the API. */}
                        {c.data_url && (
                          <div className="flex items-start gap-3 flex-wrap">
                            <a
                              href={c.data_url}
                              target="_blank"
                              rel="noreferrer"
                              className="block shrink-0"
                              title="Open full image"
                            >
                              <img
                                src={c.data_url}
                                alt={`Uploaded scorecard ${c.filename}`}
                                className="rounded-md ring-1 ring-cream-100/15 max-h-32 object-contain bg-brand-900/30"
                              />
                            </a>
                            <div className="space-y-1 min-w-0 flex-1">
                              {c.debug?.model && (
                                <p className="text-cream-100/60">
                                  Model:{" "}
                                  <span className="font-mono text-cream-100/85">
                                    {c.debug.model}
                                  </span>
                                  {c.debug.no_player_hint === false && (
                                    <span className="text-amber-300 ml-1">
                                      (with player hints)
                                    </span>
                                  )}
                                </p>
                              )}
                              {c.debug?.data_url_bytes != null && (
                                <p className="text-cream-100/60">
                                  Image payload:{" "}
                                  <span className="font-mono text-cream-100/85">
                                    {(c.debug.data_url_bytes / 1024).toFixed(0)}{" "}
                                    KB
                                  </span>
                                </p>
                              )}
                              {c.preprocess && (
                                <p className="text-cream-100/60">
                                  Preprocess:{" "}
                                  <span className="font-mono text-cream-100/85">
                                    {c.preprocess.reencoded
                                      ? `${c.preprocess.source_w}×${c.preprocess.source_h}`
                                      : "raw"}
                                  </span>
                                  {c.preprocess.scaled && (
                                    <span className="text-cream-100/85">
                                      {" "}
                                      →{" "}
                                      <span className="font-mono">
                                        {c.preprocess.output_w}×
                                        {c.preprocess.output_h}
                                      </span>
                                    </span>
                                  )}
                                  {c.preprocess.reencoded ? (
                                    <span className="text-emerald-300/85 ml-1">
                                      · EXIF-rotated
                                    </span>
                                  ) : (
                                    <span className="text-cream-100/45 ml-1">
                                      · small file, passthrough
                                    </span>
                                  )}
                                </p>
                              )}
                              {c.debug?.called_at && (
                                <p className="text-cream-100/60">
                                  Called:{" "}
                                  <span className="font-mono text-cream-100/85">
                                    {new Date(c.debug.called_at).toLocaleTimeString()}
                                  </span>
                                  {c.debug?.attempts && c.debug.attempts > 1 && (
                                    <span className="text-amber-300 ml-1">
                                      · auto-retried (model gave up first time)
                                    </span>
                                  )}
                                  {c.retry_count != null && c.retry_count > 0 && (
                                    <span className="text-cream-100/45 ml-1">
                                      · manual retry {c.retry_count}
                                    </span>
                                  )}
                                </p>
                              )}
                              {c.status === "parsed" && c.data_url && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  <button
                                    type="button"
                                    className="btn-ghost text-[10px]"
                                    onClick={() => retryCard(c.id)}
                                    title="Re-run OCR on the same image. Useful when the first parse came back empty or templated."
                                  >
                                    ↻ Retry
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost text-[10px]"
                                    onClick={() => rotateCard(c.id)}
                                    title="Rotate the image 90° clockwise + re-OCR. Use when the card was photographed sideways."
                                  >
                                    ⟳ Rotate 90°
                                  </button>
                                  <details className="inline-block">
                                    <summary className="btn-ghost text-[10px] cursor-pointer">
                                      ✂ Crop & retry
                                    </summary>
                                    <div className="mt-1 ml-2 flex flex-wrap gap-1">
                                      <button
                                        type="button"
                                        className="btn-ghost text-[10px] text-cream-100/75"
                                        onClick={() => cropAndRetry(c.id, "top")}
                                        title="OCR only the top half of the card (often front 9)."
                                      >
                                        Top half
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost text-[10px] text-cream-100/75"
                                        onClick={() => cropAndRetry(c.id, "bottom")}
                                        title="OCR only the bottom half (often back 9)."
                                      >
                                        Bottom half
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost text-[10px] text-cream-100/75"
                                        onClick={() => cropAndRetry(c.id, "left")}
                                        title="OCR only the left half of the card."
                                      >
                                        Left half
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost text-[10px] text-cream-100/75"
                                        onClick={() => cropAndRetry(c.id, "right")}
                                        title="OCR only the right half of the card."
                                      >
                                        Right half
                                      </button>
                                    </div>
                                  </details>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {c.row_outcomes && c.row_outcomes.length > 0 && (
                          <div>
                            <p className="font-medium text-cream-100/75">
                              Per-row outcome ({c.row_outcomes.length})
                            </p>
                            <ul className="space-y-1 mt-1">
                              {c.row_outcomes.map((o, i) => {
                                const tone =
                                  o.outcome === "merged"
                                    ? "text-emerald-300"
                                    : o.outcome === "unmatched_panel"
                                    ? "text-amber-300"
                                    : "text-cream-100/45";
                                return (
                                  <li
                                    key={i}
                                    className="flex items-start justify-between gap-2"
                                  >
                                    <span className="font-mono truncate">
                                      &ldquo;{o.ocr_name}&rdquo;
                                    </span>
                                    <span className={`shrink-0 ${tone}`}>
                                      {o.scores_parsed} score
                                      {o.scores_parsed === 1 ? "" : "s"} ·{" "}
                                      {o.outcome === "merged"
                                        ? `→ ${o.matched_to} (${o.match_score}%)`
                                        : o.outcome === "unmatched_panel"
                                        ? o.match_score > 0
                                          ? `mapping (${o.match_score}% best)`
                                          : "mapping (no suggestion)"
                                        : "dropped — empty row"}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                        {c.pattern_warnings && c.pattern_warnings.length > 0 && (
                          <div className="rounded-md border border-red-400/30 bg-red-500/10 p-2 space-y-1">
                            <p className="font-medium text-red-200 text-[11px]">
                              Pattern warnings ({c.pattern_warnings.length})
                            </p>
                            <p className="text-[10px] text-red-100/80 leading-snug">
                              The OCR output tripped these heuristics. Cells
                              from flagged rows are tagged{" "}
                              <span className="text-amber-200">templated</span>{" "}
                              in the Suggestions panel — review carefully.
                            </p>
                            <ul className="space-y-0.5">
                              {c.pattern_warnings.map((w, i) => (
                                <li
                                  key={i}
                                  className="text-[11px] text-red-100"
                                >
                                  · {w.detail}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {c.debug?.raw_text && (
                          <details className="text-[10px] font-mono">
                            <summary className="cursor-pointer hover:text-cream-100/85">
                              Raw model output
                              {c.debug?.attempts && c.debug.attempts > 1
                                ? " (winning attempt)"
                                : ""}
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all text-cream-100/55 max-h-48 overflow-auto">
                              {c.debug.raw_text}
                            </pre>
                          </details>
                        )}
                        {c.debug?.first_attempt_raw && (
                          <details className="text-[10px] font-mono">
                            <summary className="cursor-pointer hover:text-cream-100/85">
                              First attempt (auto-retried, returned no scores)
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all text-cream-100/55 max-h-48 overflow-auto">
                              {c.debug.first_attempt_raw}
                            </pre>
                          </details>
                        )}
                      </div>
                    </details>
                  )}
              </li>
            ))}
          </ul>
        )}

        {err && <p className="text-sm text-red-300">{err}</p>}

        <p className="text-[11px] text-cream-100/55">
          OCR is a best-effort parse. You can also skip uploads entirely and
          fill scores by hand in the grid below.
        </p>
      </div>

      {/* OCR suggestions panel. Cruz Golf treats OCR as ASSISTIVE:
          every cell the model proposed is shown here for explicit
          accept, including the high-confidence ones. Grouped by
          player so the user can accept a whole row in one tap when
          it looks right, with a top-level "Accept all
          high-confidence reads" bulk action for the fast path. */}
      {suggestions.length > 0 && (() => {
        // Group suggestions by player for the per-player bulk action
        // ("Accept all for Cruz"). Stable order: in the round's
        // player order.
        const byPlayer = new Map<string, Suggestion[]>();
        for (const s of suggestions) {
          const arr = byPlayer.get(s.round_player_id) ?? [];
          arr.push(s);
          byPlayer.set(s.round_player_id, arr);
        }
        // Sort cells within each player by hole index for readability.
        for (const arr of byPlayer.values()) {
          arr.sort((a, b) => a.hole_index - b.hole_index);
        }
        const playerOrder = players
          .filter((p) => byPlayer.has(p.round_player_id))
          .map((p) => ({
            rp_id: p.round_player_id,
            name: p.name,
            entries: byPlayer.get(p.round_player_id) ?? []
          }));

        // Resolve the right CellSource for an accepted suggestion.
        // High + clean → ocr_high (solid amber). Low confidence →
        // ocr_low (dashed amber). Way-off-par or pattern-flagged →
        // ocr_suspicious (red ring). Preserving the tier in the
        // accepted cell means the user can still see "you accepted
        // this from a low-confidence OCR read" when reviewing the
        // grid later. Per Patrick 2026-05-12: provenance survives
        // acceptance.
        function sourceFor(s: Suggestion): CellSource {
          const isSuspicious = s.reasons.some((r) =>
            r.startsWith("way off par")
          );
          const isPattern = s.reasons.includes(
            "row matches a suspicious pattern"
          );
          if (isSuspicious || isPattern) return "ocr_suspicious";
          if (s.confidence === "low" || s.confidence == null) return "ocr_low";
          return "ocr_high";
        }

        function acceptOne(s: Suggestion) {
          const src = sourceFor(s);
          setGrid((prev) =>
            prev.map((row) =>
              row.round_player_id === s.round_player_id
                ? {
                    ...row,
                    scores: row.scores.map((v, i) =>
                      i === s.hole_index ? s.value : v
                    ),
                    sources: row.sources.map((existingSrc, i) =>
                      i === s.hole_index ? src : existingSrc
                    )
                  }
                : row
            )
          );
          setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
        }

        function acceptPlayer(rpId: string) {
          const entries = byPlayer.get(rpId) ?? [];
          if (entries.length === 0) return;
          const byHole = new Map<number, { value: number; src: CellSource }>();
          for (const e of entries) {
            byHole.set(e.hole_index, { value: e.value, src: sourceFor(e) });
          }
          setGrid((prev) =>
            prev.map((row) =>
              row.round_player_id === rpId
                ? {
                    ...row,
                    scores: row.scores.map((v, i) =>
                      byHole.has(i) ? byHole.get(i)!.value : v
                    ),
                    sources: row.sources.map((existingSrc, i) =>
                      byHole.has(i) ? byHole.get(i)!.src : existingSrc
                    )
                  }
                : row
            )
          );
          setSuggestions((prev) =>
            prev.filter((x) => x.round_player_id !== rpId)
          );
        }

        function skipPlayer(rpId: string) {
          setSuggestions((prev) =>
            prev.filter((x) => x.round_player_id !== rpId)
          );
        }

        // Tier the suggestions for the header summary + the
        // "Accept all high-confidence reads" bulk action. A
        // suggestion is "clean high" only if the model reported
        // high confidence AND we didn't tag the cell with any
        // reason (par-suspicious, pattern-quarantined). Anything
        // with a reason needs human judgment regardless of model
        // confidence.
        const cleanHigh = suggestions.filter(
          (s) => s.confidence === "high" && s.reasons.length === 0
        );
        const uncertainCount = suggestions.filter(
          (s) => s.confidence === "low"
        ).length;
        const suspiciousCount = suggestions.filter((s) =>
          s.reasons.some((r) => r.startsWith("way off par"))
        ).length;
        const patternCount = suggestions.filter((s) =>
          s.reasons.includes("row matches a suspicious pattern")
        ).length;

        function acceptAllHighConfidence() {
          if (cleanHigh.length === 0) return;
          // Map round_player_id → (hole_index → value).
          const byPlayerByHole = new Map<string, Map<number, number>>();
          for (const s of cleanHigh) {
            const inner =
              byPlayerByHole.get(s.round_player_id) ??
              new Map<number, number>();
            inner.set(s.hole_index, s.value);
            byPlayerByHole.set(s.round_player_id, inner);
          }
          setGrid((prev) =>
            prev.map((row) => {
              const inner = byPlayerByHole.get(row.round_player_id);
              if (!inner) return row;
              return {
                ...row,
                scores: row.scores.map((v, i) =>
                  inner.has(i) ? inner.get(i)! : v
                ),
                sources: row.sources.map((src, i) =>
                  inner.has(i) ? ("ocr_high" as CellSource) : src
                )
              };
            })
          );
          const acceptedIds = new Set(cleanHigh.map((s) => s.id));
          setSuggestions((prev) =>
            prev.filter((x) => !acceptedIds.has(x.id))
          );
        }

        return (
          <div className="card p-4 border border-amber-400/40 bg-amber-500/5 space-y-3">
            <div className="space-y-2">
              <p className="h-eyebrow text-amber-300">
                OCR · review {suggestions.length} read
                {suggestions.length === 1 ? "" : "s"} before they
                land in your scorecard
              </p>
              {/* Tier breakdown — gives the user the right mental
                  model up front so they know what kind of review is
                  needed. Per Patrick 2026-05-12: OCR is Beta, OCR is
                  assistive, nothing lands silently. */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm ring-1 ring-emerald-400/60 bg-emerald-500/15 shrink-0" />
                  <span className="tabular-nums text-cream-100/85">
                    {cleanHigh.length} read clearly
                  </span>
                </span>
                {uncertainCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-amber-400/70 bg-amber-500/5 shrink-0" />
                    <span className="tabular-nums text-cream-100/85">
                      {uncertainCount} uncertain
                    </span>
                  </span>
                )}
                {suspiciousCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm ring-2 ring-red-400/70 bg-red-500/10 shrink-0" />
                    <span className="tabular-nums text-red-200">
                      {suspiciousCount} way off par
                    </span>
                  </span>
                )}
                {patternCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm ring-2 ring-amber-500/70 bg-amber-500/10 shrink-0" />
                    <span className="tabular-nums text-amber-200">
                      {patternCount} row looks templated
                    </span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-cream-100/65 leading-snug">
                Cruz Golf treats OCR as <span className="text-cream-50">assistive</span>{" "}
                — nothing lands in your scorecard until you accept it.
                Wrong scores are worse than no scores.
              </p>
              <div className="flex gap-2 flex-wrap pt-1">
                {cleanHigh.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={acceptAllHighConfidence}
                    title="Accepts every cell the model read clearly (high confidence + par-plausible + pattern-clean). Uncertain / off-par / templated cells stay below for individual review."
                  >
                    ✓ Accept all {cleanHigh.length} clear read
                    {cleanHigh.length === 1 ? "" : "s"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost text-xs text-cream-100/85"
                  onClick={() => setSuggestions([])}
                  title="Drop every suggestion without applying"
                >
                  Skip all
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {playerOrder.map((p) => (
                <div
                  key={p.rp_id}
                  className="rounded-lg bg-brand-900/30 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-cream-50">
                      {p.name}{" "}
                      <span className="text-cream-100/55 text-xs">
                        · {p.entries.length} cell
                        {p.entries.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className="btn-primary text-[11px] px-2.5 py-1"
                        onClick={() => acceptPlayer(p.rp_id)}
                        title="Accept every suggestion for this player, including any flagged as a pattern duplicate. Use this when the row looks right at a glance."
                      >
                        Accept all for {p.name.split(" ")[0]}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-[11px] text-cream-100/65 px-2.5 py-1"
                        onClick={() => skipPlayer(p.rp_id)}
                      >
                        Skip all
                      </button>
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5 text-xs">
                    {p.entries.map((s) => {
                      // Confidence tier visual: emerald ring = read
                      // clearly; dashed amber = uncertain; red ring =
                      // way off par; amber ring = row matches a
                      // templated pattern. The tier follows the same
                      // legend as the summary at the top of the panel
                      // so the user can match counts to specific cells.
                      const isClean =
                        s.confidence === "high" && s.reasons.length === 0;
                      const isSuspicious = s.reasons.some((r) =>
                        r.startsWith("way off par")
                      );
                      const isPattern = s.reasons.includes(
                        "row matches a suspicious pattern"
                      );
                      const isUncertain = s.confidence !== "high";
                      const chipClass = isSuspicious
                        ? "ring-2 ring-red-400/70 bg-red-500/10"
                        : isPattern
                        ? "ring-2 ring-amber-500/70 bg-amber-500/10"
                        : isUncertain
                        ? "border border-dashed border-amber-400/70 bg-amber-500/5"
                        : isClean
                        ? "ring-1 ring-emerald-400/60 bg-emerald-500/10"
                        : "bg-brand-900/50";
                      const title =
                        s.reasons.length > 0
                          ? s.reasons.join(" · ")
                          : "Model read this clearly";
                      return (
                        <li
                          key={s.id}
                          className={`rounded-md px-2 py-1 flex items-center gap-1.5 group ${chipClass}`}
                          title={title}
                        >
                          <span className="text-cream-100/55 tabular-nums text-[10px]">
                            h{s.hole_index + 1}
                          </span>
                          <span className="font-serif text-cream-50 tabular-nums">
                            {s.value}
                          </span>
                          <button
                            type="button"
                            className="text-emerald-300 hover:text-emerald-200 text-[10px] px-1"
                            onClick={() => acceptOne(s)}
                            title="Use this single cell"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className="text-cream-100/45 hover:text-red-300 text-[10px] px-1"
                            onClick={() =>
                              setSuggestions((prev) =>
                                prev.filter((x) => x.id !== s.id)
                              )
                            }
                            title="Skip this cell"
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {unmatched.length > 0 && (
        <div className="card p-4 border border-amber-400/40 bg-amber-500/5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="h-eyebrow text-amber-300">
                Map {unmatched.length} row
                {unmatched.length === 1 ? "" : "s"} to players
              </p>
              <p className="text-xs text-cream-100/75 mt-1 leading-snug">
                The scorecard had these names that didn&apos;t auto-match.
                Pick the right player and the scores will merge into the
                grid below. Skip a row to drop it.
              </p>
            </div>
            {unmatched.some((u) => u.suggested_rp_id) && (
              <button
                type="button"
                onClick={() => {
                  // Merge every row that has a suggested player. Rows
                  // without a suggestion stay in the panel for manual
                  // mapping. Useful when the user just wants to
                  // accept all the bestMatch picks at once.
                  const toMerge = unmatched.filter(
                    (u) => u.suggested_rp_id
                  );
                  if (toMerge.length === 0) return;
                  // Review-first: every non-null cell becomes a
                  // suggestion (nothing lands in the grid silently).
                  // Same model as the matched-row path. Per Patrick
                  // 2026-05-12.
                  const newSugs: Suggestion[] = [];
                  setGrid((prev) =>
                    prev.map((row) => {
                      const match = toMerge.find(
                        (u) => u.suggested_rp_id === row.round_player_id
                      );
                      if (!match) return row;
                      match.scores.forEach((ocrVal, idx) => {
                        if (ocrVal == null) return;
                        const par = holePars[idx] ?? 4;
                        const suspicious = isSuspiciousVsPar(ocrVal, par);
                        const c = match.confidences[idx];
                        const reasons: string[] = [];
                        if (c !== "high") reasons.push("model is uncertain");
                        if (suspicious) reasons.push(`way off par (${par})`);
                        if (match.pattern_warned)
                          reasons.push("row matches a suspicious pattern");
                        newSugs.push({
                          id: `sug-${match.id}-h${idx}`,
                          card_id: match.card_id,
                          round_player_id: row.round_player_id,
                          player_name: row.name,
                          hole_index: idx,
                          value: ocrVal,
                          confidence: c ?? null,
                          reasons
                        });
                      });
                      // Record source filename so the user can see
                      // which card the suggestions came from, but the
                      // grid scores + sources stay untouched.
                      const sources = row.source_filenames.includes(match.filename)
                        ? row.source_filenames
                        : [...row.source_filenames, match.filename];
                      return { ...row, source_filenames: sources };
                    })
                  );
                  if (newSugs.length > 0) {
                    setSuggestions((prev) => [...prev, ...newSugs]);
                  }
                  setUnmatched((prev) =>
                    prev.filter((u) => !u.suggested_rp_id)
                  );
                }}
                className="btn-secondary text-xs shrink-0"
                title="Apply all suggested matches in one tap"
              >
                Merge all suggested
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {unmatched.map((u) => {
              const scoredCells = u.scores.filter((s) => s != null).length;
              return (
                <li
                  key={u.id}
                  className="rounded-xl border border-cream-100/12 bg-brand-900/30 p-3 space-y-2"
                >
                  {/* Top row: OCR name + meta. Always full-width. */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-cream-50 text-sm truncate">
                        &ldquo;{u.ocr_name}&rdquo;
                      </div>
                      <p className="text-[11px] text-cream-100/55 mt-0.5">
                        {scoredCells} score
                        {scoredCells === 1 ? "" : "s"} parsed · from{" "}
                        {u.filename}
                      </p>
                    </div>
                    {u.suggested_rp_id && u.suggested_score > 0 && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30 shrink-0">
                        {u.suggested_score}% match
                      </span>
                    )}
                  </div>
                  {/* Action row: full-width select on mobile, inline
                      on sm+. Buttons sit below so they don't pinch the
                      select into a tiny touch target. */}
                  <div className="flex items-stretch gap-2 flex-col sm:flex-row">
                    <select
                      className="input text-sm flex-1 min-w-0"
                      value={u.suggested_rp_id ?? ""}
                      onChange={(e) => {
                        const rpId = e.target.value;
                        setUnmatched((prev) =>
                          prev.map((row) =>
                            row.id === u.id
                              ? { ...row, suggested_rp_id: rpId || null }
                              : row
                          )
                        );
                      }}
                      aria-label="Map this row to a player"
                    >
                      <option value="">— pick player —</option>
                      {players.map((p) => (
                        <option key={p.round_player_id} value={p.round_player_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="btn-primary text-xs flex-1 sm:flex-none"
                        disabled={!u.suggested_rp_id}
                        onClick={() => {
                          if (!u.suggested_rp_id) return;
                          // Review-first: every non-null cell flows
                          // to suggestions. Nothing lands in the grid
                          // silently. Per Patrick 2026-05-12.
                          const newSugsHere: Suggestion[] = [];
                          const targetRpId = u.suggested_rp_id;
                          setGrid((prev) =>
                            prev.map((row) => {
                              if (row.round_player_id !== targetRpId)
                                return row;
                              u.scores.forEach((ocrVal, idx) => {
                                if (ocrVal == null) return;
                                const par = holePars[idx] ?? 4;
                                const suspicious = isSuspiciousVsPar(ocrVal, par);
                                const c = u.confidences[idx];
                                const reasons: string[] = [];
                                if (c !== "high")
                                  reasons.push("model is uncertain");
                                if (suspicious)
                                  reasons.push(`way off par (${par})`);
                                if (u.pattern_warned)
                                  reasons.push(
                                    "row matches a suspicious pattern"
                                  );
                                newSugsHere.push({
                                  id: `sug-${u.id}-h${idx}`,
                                  card_id: u.card_id,
                                  round_player_id: targetRpId,
                                  player_name: row.name,
                                  hole_index: idx,
                                  value: ocrVal,
                                  confidence: c ?? null,
                                  reasons
                                });
                              });
                              const sources = row.source_filenames.includes(u.filename)
                                ? row.source_filenames
                                : [...row.source_filenames, u.filename];
                              return { ...row, source_filenames: sources };
                            })
                          );
                          if (newSugsHere.length > 0) {
                            setSuggestions((prev) => [...prev, ...newSugsHere]);
                          }
                          setUnmatched((prev) =>
                            prev.filter((row) => row.id !== u.id)
                          );
                        }}
                      >
                        Merge →
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs text-cream-100/55 flex-1 sm:flex-none"
                        onClick={() =>
                          setUnmatched((prev) =>
                            prev.filter((row) => row.id !== u.id)
                          )
                        }
                        title="Drop this row — its scores won't be saved"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Grid-level progress counter — answers "am I done?" at a
          glance. Counts non-null cells across every row, divided by
          the total number of cells expected (rows × holes). Shows
          green when complete, amber-ish when partial. */}
      {(() => {
        const filled = grid.reduce(
          (sum, r) => sum + r.scores.filter((s) => s != null).length,
          0
        );
        const total = grid.length * holes;
        if (total === 0) return null;
        const pct = Math.round((filled / total) * 100);
        const done = filled === total;
        const empty = filled === 0;
        return (
          <div className="card px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                  done
                    ? "bg-emerald-400"
                    : empty
                    ? "bg-cream-100/30"
                    : "bg-amber-400"
                }`}
                aria-hidden="true"
              />
              <span className="text-cream-100/85 tabular-nums">
                {filled} of {total} cells filled
              </span>
              <span className="text-cream-100/55">·</span>
              <span className="text-cream-100/55 tabular-nums">{pct}%</span>
            </div>
            <span className="text-cream-100/55 text-[11px]">
              {done
                ? "Ready to save"
                : empty
                ? "Type scores below, or upload a card above"
                : "Tap any empty cell to fill — partial saves are fine"}
            </span>
          </div>
        );
      })()}

      <div className="card p-2 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-cream-100/55 text-xs uppercase tracking-wide">
              <th className="p-2 text-left">Player</th>
              {Array.from({ length: holes }, (_, i) => (
                <th key={i} className="p-1 w-12 text-center">{i + 1}</th>
              ))}
              <th className="p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row, idx) => {
              const total = row.scores.reduce((s: number, v) => s + (v ?? 0), 0);
              return (
                <tr key={row.round_player_id} className="border-t border-cream-100/8">
                  <td className="p-2 font-medium whitespace-nowrap text-cream-50">
                    <div>{row.name}</div>
                    {row.source_filenames.length > 0 && (
                      <div className="text-[10px] text-cream-100/45">
                        from {row.source_filenames.length} card
                        {row.source_filenames.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                  {row.scores.map((v, i) => {
                    // Visual provenance — three OCR confidence tiers:
                    //   high       → solid amber (trust + verify)
                    //   low        → dashed amber (uncertain, review)
                    //   suspicious → red ring (way off par; almost
                    //                certainly wrong, fix this)
                    // db = blue tint (server-side saved). manual = no
                    // marker. Empty = dashed gray outline.
                    const src = row.sources[i];
                    const par = holePars[i] ?? 4;
                    const tone =
                      src === "ocr_suspicious"
                        ? "ring-2 ring-red-400/70 bg-red-500/10"
                        : src === "ocr_high"
                        ? "ring-1 ring-amber-400/60 bg-amber-500/10"
                        : src === "ocr_low"
                        ? "border border-dashed border-amber-400/70 bg-amber-500/5"
                        : src === "db"
                        ? "ring-1 ring-sky-400/40 bg-sky-500/5"
                        : v == null
                        ? "border border-dashed border-cream-100/15"
                        : "";
                    const titleText =
                      src === "ocr_suspicious"
                        ? `OCR read ${v} — that's way off par ${par}. Likely wrong; verify.`
                        : src === "ocr_high"
                        ? "Read from scorecard photo (high confidence). Verify before saving."
                        : src === "ocr_low"
                        ? "Read from scorecard photo (uncertain). Verify before saving."
                        : src === "db"
                        ? "Saved on the server"
                        : src === "manual"
                        ? "Hand-entered"
                        : "Blank — tap to fill";
                    return (
                      <td key={i} className="p-1">
                        <input
                          className={`input w-12 px-1 text-center text-sm ${tone}`}
                          type="number"
                          inputMode="numeric"
                          value={v ?? ""}
                          title={titleText}
                          data-suspicious={src === "ocr_suspicious" ? "true" : undefined}
                          onChange={(e) =>
                            setCell(
                              idx,
                              i,
                              (() => {
                                // Guard against parseInt-without-radix
                                // accepting partial numerics and the
                                // result writing NaN to the grid + DB.
                                const raw = e.target.value;
                                if (raw === "") return null;
                                const n = Number.parseInt(raw, 10);
                                return Number.isFinite(n) ? n : null;
                              })()
                            )
                          }
                        />
                      </td>
                    );
                  })}
                  <td className="p-2 text-right tabular-nums text-cream-50">
                    {total > 0 ? total : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save scores"}
        </button>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// fuzzy name matching lives in lib/ocr/name-match.ts (testable in
// isolation). Use bestMatch / fuzzyMatchScore there for any new code.
