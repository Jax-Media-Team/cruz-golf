/**
 * Post-hoc pattern detection on OCR output.
 *
 * Patrick caught the model pattern-filling — emitting plausible-looking
 * golf score sequences (5,4,4,3,5,4,4...) that didn't match the actual
 * handwritten card. Per-cell confidence from the model is necessary but
 * not sufficient: the model can confidently emit a pattern that's
 * internally consistent but wrong.
 *
 * This module looks for ROW-LEVEL or ACROSS-ROW signals that the parse
 * was generated rather than transcribed. The detected patterns are
 * surfaced as warnings; the upload-view downgrades affected rows from
 * "auto-fill" to "suggestion-only" so the user explicitly confirms
 * each cell.
 *
 * Pure function. No DB / React / Supabase.
 */
import type { CellConfidence } from "./index";

export type PatternWarningType =
  /** Two player rows have ≥80% identical scores on ≥6 compared holes.
   *  Strong indicator the model templated one row into the others. */
  | "players_similar"
  /** A player row matches the par row on ≥90% of scored holes —
   *  the model probably read the par row instead of the score row. */
  | "matches_par"
  /** All a player's recorded scores fall within a 2-digit range
   *  (e.g. only 4s and 5s across 18 holes). Possible for some
   *  rounds but combined with other signals it's a templating tell. */
  | "low_variance"
  /** Player's front-9 sequence ≈ back-9 sequence. The card almost
   *  never has identical 9s; this is OCR duplication. */
  | "front_back_identical"
  /** Every cell in a row has the same value. Conclusive
   *  pattern-fill — return nothing. */
  | "uniform_value";

export type PatternWarning = {
  type: PatternWarningType;
  /** Index into the `rows` array (the affected player row). May be
   *  paired with `row_index_b` for cross-row warnings. */
  row_index: number;
  /** Set on `players_similar` — the OTHER row this one matches. */
  row_index_b?: number;
  /** Human-readable explanation surfaced in the diagnostics panel
   *  and (when relevant) in the cell tooltip. */
  detail: string;
};

export type PatternCheckInput = {
  rows: Array<{ name: string; scores: Array<number | null> }>;
  /** Per-hole pars. Length should equal scores[i].length for each
   *  row. Optional — when absent, the `matches_par` check is skipped. */
  pars?: number[];
};

export type PatternCheckResult = {
  warnings: PatternWarning[];
  /** Rows the consumer should treat as "suggestion-only" (don't
   *  auto-fill the grid). Includes any row that triggered AT LEAST
   *  ONE warning, plus rows duplicated by a `players_similar`
   *  warning. */
  rows_to_quarantine: Set<number>;
};

// =============================================================
// Public API
// =============================================================

export function detectSuspiciousPatterns(
  input: PatternCheckInput
): PatternCheckResult {
  const { rows, pars } = input;
  const warnings: PatternWarning[] = [];
  if (rows.length === 0) {
    return { warnings, rows_to_quarantine: new Set() };
  }

  // 1. Uniform value (every cell same digit) — conclusive pattern-fill.
  rows.forEach((row, idx) => {
    const values = row.scores.filter((s): s is number => s != null);
    if (values.length >= 6 && new Set(values).size === 1) {
      warnings.push({
        type: "uniform_value",
        row_index: idx,
        detail: `${rowLabel(row, idx)} scored ${values[0]} on every hole — almost certainly OCR pattern-fill`
      });
    }
  });

  // 2. Low variance — all values within a tight 2-value range.
  rows.forEach((row, idx) => {
    const values = row.scores.filter((s): s is number => s != null);
    if (values.length >= 8) {
      const unique = new Set(values);
      const allParRange = values.every((v) => v >= 3 && v <= 5);
      if (allParRange && unique.size <= 2) {
        warnings.push({
          type: "low_variance",
          row_index: idx,
          detail: `${rowLabel(row, idx)} only has ${[...unique]
            .sort()
            .join(" / ")} across ${values.length} holes — unrealistic variance for a real round`
        });
      }
    }
  });

  // 3. Matches par — the model likely read the par row.
  if (pars && pars.length > 0) {
    rows.forEach((row, idx) => {
      let compared = 0;
      let matches = 0;
      row.scores.forEach((s, i) => {
        if (s == null) return;
        if (pars[i] == null) return;
        compared += 1;
        if (s === pars[i]) matches += 1;
      });
      if (compared >= 6 && matches / compared >= 0.9) {
        warnings.push({
          type: "matches_par",
          row_index: idx,
          detail: `${rowLabel(row, idx)} matches par on ${matches}/${compared} holes — model likely read the par row`
        });
      }
    });
  }

  // 4. Front-9 / back-9 identical (only on 18-hole rounds).
  rows.forEach((row, idx) => {
    if (row.scores.length !== 18) return;
    const front = row.scores.slice(0, 9);
    const back = row.scores.slice(9, 18);
    let compared = 0;
    let matches = 0;
    for (let i = 0; i < 9; i++) {
      if (front[i] == null || back[i] == null) continue;
      compared += 1;
      if (front[i] === back[i]) matches += 1;
    }
    if (compared >= 6 && matches / compared >= 0.9) {
      warnings.push({
        type: "front_back_identical",
        row_index: idx,
        detail: `${rowLabel(row, idx)} has identical front 9 and back 9 (${matches}/${compared}) — OCR duplicated half the card`
      });
    }
  });

  // 5. Players-similar — pairwise check across rows. We only flag the
  //    LATER row as the duplicate (preserves the first row's data when
  //    the consumer quarantines).
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i].scores;
      const b = rows[j].scores;
      let compared = 0;
      let matches = 0;
      const minLen = Math.min(a.length, b.length);
      // Tunable: if a hole's par is known and BOTH players score par
      // on it, that's weak evidence of templating (real golfers
      // commonly both par the same hole). The matching cell counts
      // toward `matches` but we ALSO track non-par matches separately
      // — at least some non-par matches are required to fire.
      for (let k = 0; k < minLen; k++) {
        if (a[k] == null || b[k] == null) continue;
        compared += 1;
        if (a[k] === b[k]) matches += 1;
      }
      // 2026-05-12 threshold tune: raised from 80% / 6 holes to 90% /
      // 9 holes. Real partner-play rounds where two similar-handicap
      // golfers play together can legitimately match on 6-7 of 9
      // holes (par the same set, bogey the same hard holes); the
      // earlier threshold quarantined those rows. Requiring 90%
      // match on at least 9 holes catches OCR template-fill
      // (which produces ~100% match) while letting clean rounds
      // through. The wider `players_similar` net was over-triggering
      // even on cards where the model genuinely read distinct rows.
      if (compared >= 9 && matches / compared >= 0.9) {
        warnings.push({
          type: "players_similar",
          row_index: j,
          row_index_b: i,
          detail: `${rowLabel(rows[j], j)} matches ${rowLabel(
            rows[i],
            i
          )} on ${matches}/${compared} holes — likely OCR templated one player's scores into another's row`
        });
      }
    }
  }

  // Build the quarantine set — any row mentioned in any warning.
  const quarantine = new Set<number>();
  for (const w of warnings) {
    quarantine.add(w.row_index);
    if (w.row_index_b != null) quarantine.add(w.row_index_b);
  }
  return { warnings, rows_to_quarantine: quarantine };
}

// =============================================================
// Helpers
// =============================================================

function rowLabel(
  row: { name: string },
  idx: number
): string {
  const n = (row.name ?? "").trim();
  return n.length > 0 ? `"${n}"` : `Row ${idx + 1}`;
}

/**
 * Short summary chip for the bulk-actions header. Returns a one-liner
 * for each warning type with the count. Used by the upload-view's
 * pattern-warning summary so the user can see at a glance what
 * tripped without reading every detail.
 */
export function summarizePatternWarnings(
  warnings: PatternWarning[]
): Array<{ type: PatternWarningType; count: number; label: string }> {
  const map = new Map<PatternWarningType, number>();
  for (const w of warnings) {
    map.set(w.type, (map.get(w.type) ?? 0) + 1);
  }
  const labels: Record<PatternWarningType, string> = {
    players_similar: "row duplicated across players",
    matches_par: "row matches par",
    low_variance: "row has too little variance",
    front_back_identical: "front 9 = back 9",
    uniform_value: "row is all one value"
  };
  return [...map.entries()].map(([type, count]) => ({
    type,
    count,
    label: labels[type]
  }));
}

/**
 * Decide if a SPECIFIC cell — given the merged confidence + par
 * suspicion + pattern-warned row status — is trustworthy enough to
 * auto-fill the grid. Patrick's stricter rule: a cell only auto-fills
 * when it's ALL of:
 *   - model returned "high" confidence
 *   - score is within plausible par range
 *   - the row is not flagged for any pattern warning
 *
 * Returns true to auto-fill, false to surface as a suggestion.
 */
export function shouldAutoFillCell(args: {
  confidence: CellConfidence;
  is_par_suspicious: boolean;
  row_is_quarantined: boolean;
}): boolean {
  return (
    args.confidence === "high" &&
    !args.is_par_suspicious &&
    !args.row_is_quarantined
  );
}
