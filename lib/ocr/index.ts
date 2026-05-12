/**
 * Pluggable scorecard OCR. Default adapter: OpenAI gpt-4o vision.
 * If OPENAI_API_KEY is unset, returns a "blank" parse so the user can hand-type.
 *
 * Wraps the upstream call in `retry()` with exponential backoff so a transient
 * 429/5xx from OpenAI never bubbles up to the user.
 *
 * Design decisions (forced by a real-world bug Patrick caught 2026-05-11):
 *
 * 1. **NO player-list hint passed to the model.** Earlier versions passed
 *    `Players: ${players.join(", ")}` to the model so it could disambiguate
 *    sloppy handwriting. gpt-4o consistently took the "easy completion":
 *    it would return the player-list names verbatim with `scores:
 *    [null, null, ...]`, never actually doing the pixel work. The
 *    diagnostic panel showed the model returning `"Patrick Cruz"` for
 *    every row even when the card said `"Cruz (5)"` in pencil — proof
 *    the model wasn't reading the card. The application's bestMatch
 *    fuzzy matcher (`lib/ocr/name-match.ts`) already handles the
 *    "Cruz" → "Patrick Cruz" disambiguation downstream, so the hint
 *    was both unnecessary AND actively harmful. We now ask the model
 *    to transcribe what it sees and let the app match names.
 *
 * 2. **`detail: "high"`** — without this, the API downsamples the image
 *    aggressively. Fatal for pencil handwriting on a paper card. We
 *    pay a small cost increase per call but the parse quality jump is
 *    the difference between "no scores read" and a usable grid.
 *
 * 3. **`temperature: 0`** for deterministic output across retries.
 *
 * 4. **Hard "no hallucinated names" instruction** — the prompt now
 *    explicitly forbids returning made-up names from prior context.
 */
import { retry } from "../retry";
import { detectSuspiciousPatterns } from "./pattern-checks";

/**
 * Confidence level the model reports for a single transcribed cell.
 *   - "high" — clearly legible digit, no plausible alternative
 *   - "low"  — best guess, the digit could be something else
 *   - null   — paired with `scores[i] === null` (empty / smudged
 *              beyond recognition; not transcribed)
 *
 * The application uses this to:
 *   - auto-fill HIGH cells into the editable grid
 *   - mark LOW cells in the grid with a dashed amber border + funnel
 *     them into a "Review uncertain cells" panel
 *   - leave NULL cells blank
 */
export type CellConfidence = "high" | "low" | null;

export interface ScorecardOCR {
  parse(input: {
    dataUrl: string;
    /**
     * Player list — kept in the signature for backward-compat and so
     * the diagnostics layer can echo "what the round expected" alongside
     * "what the model returned". **NOT** sent to the model since
     * 2026-05-11 (see file header for why).
     */
    players: string[];
    holes: 9 | 18;
    /**
     * Optional override of the model identifier — useful when Patrick
     * wants to A/B against a newer vision model without redeploying.
     * Defaults to gpt-4o.
     */
    model?: string;
  }): Promise<{
    players: Array<{
      name: string;
      scores: Array<number | null>;
      /** Parallel to `scores`. Length === scores.length. `null` for
       *  any cell where the score is null. Older deployments may not
       *  populate this — consumers should default to "low" when a
       *  score is non-null but confidence is missing. */
      confidences?: Array<CellConfidence>;
    }>;
    /** Diagnostic payload returned to the client so the upload UI can
     *  surface "where did scores get lost?" when the parsed grid comes
     *  back empty. Not persisted server-side. */
    _debug?: {
      raw_text: string;
      pre_coerce: any;
      post_coerce: any;
      /** Approximate size of the image data URL in bytes — large enough
       *  to confirm the file actually reached the API. */
      data_url_bytes: number;
      /** Model identifier passed to the API. */
      model: string;
      /** ISO timestamp of the call — useful when correlating logs. */
      called_at: string;
      /** True iff this was a no-hint call (the new default). */
      no_player_hint: boolean;
      /** Number of upstream API calls actually made. 1 for normal,
       *  2 when the first response had rows-but-no-scores and we
       *  auto-retried. */
      attempts: number;
      /** If we auto-retried, the raw text of the FIRST attempt — so
       *  the diagnostics panel shows both. */
      first_attempt_raw?: string;
    };
  }>;
}

const SYSTEM_PROMPT = `You are reading a photograph of a HANDWRITTEN paper golf scorecard.
Your ONLY job is to transcribe what is actually visible in the image,
cell by cell, AND honestly report your confidence for each cell. The
application uses your confidence to decide what to auto-fill vs. what
to flag for review — overconfidence directly causes the user to ship
wrong scores.

RESPONSE SHAPE (return ONLY JSON, no prose, no fences):

{
  "players": [
    {
      "name": "<exact literal text from the card>",
      "scores":            [4, 5, null, 4, ...],
      "score_confidences": ["high","low",null,"high", ...]
    }
  ]
}

The "scores" and "score_confidences" arrays MUST be the same length
(equal to the number of holes — 9 or 18). Element-wise pairing:
  - scores[i] is a digit OR null
  - score_confidences[i] is "high", "low", or null
  - INVARIANT: scores[i] === null  ⇔  score_confidences[i] === null
  - "high" means the digit is unambiguously legible (you can see it
    crisply, no plausible alternative reading)
  - "low" means you have a best guess but the cell is sloppy / partly
    smudged / ambiguous between two digits

THE FAILURE MODES — DO NOT do any of these:

1. **Do not pattern-fill.** A row of [4,4,4,4,4,4,4,4,4,...] or
   [5,5,5,5,5,5,...] is almost always you giving up and outputting
   "what a golf score row probably looks like" instead of reading
   pixels. Each cell is independent. Read each one.

2. **Do not normalize.** Sloppy handwriting often looks like a 4 or
   5 from a distance even when it's actually a 3 or 6. Look at each
   digit individually. Do NOT default to par-like values.

3. **Do not read non-score rows.** These printed rows are NEVER
   hole scores:
     - "Par"
     - "Men's HCP", "Ladies' HCP", "HCP", "SI" (stroke index)
     - "Yardage"
     - Tee-color rows printed at the top of the card: "Black",
       "Gold", "Blue", "White", "Green", "Silver", "Jade",
       "Cranberry", "Red", and any combo tees like
       "Black/Gold", "Silver/Jade" — these contain printed YARDAGES
       (e.g. "519, 383, 164, 413..."), NOT scores.
     - If you see numbers like 200-600 lined up across a row,
       that's a YARDAGE row. Skip it. Hole scores are almost always
       single digits (2-9).
     - "+/−" or "+/-" — this is a running net-of-par counter, not
       hole scores.

4. **Do not read totals/subtotals as hole scores.**
   - "OUT", "IN", "TOT", "Total", "Front", "Back" — summary columns,
     NOT per-hole. Their values are typically 30-50 (front/back) or
     60-100 (total). Skip them.
   - A handwritten "39" / "40" / "76" / "80" / etc. in those columns
     IS a total. Skip.
   - Any two-digit number (10+) in what looks like a per-hole cell
     is almost always a misread — either a total bleeding into the
     cell visually, or the model misreading two adjacent digits as
     one number. Return null + confidence:null, NOT the two-digit
     value.

5. **Do not confuse handicap markers with scores.**
   - "(5)", "(4)", "(2)", "(1)" next to a player's name is their
     handicap. Include the parens in the "name" field.
   - A standalone decimal like "12.3" is a handicap index. Skip.

6. **Do not over-claim confidence.** Most handwritten scorecards
   have AT LEAST a few cells where the pencil mark is genuinely
   ambiguous. If every cell in a row is "high", you're probably
   wrong. Be honest. The application can salvage low-confidence
   correctly; it CANNOT recover from a confident wrong answer.

7. **Do not overfill blanks.** If a cell is genuinely empty (no
   pencil mark at all), return null + null. Do not "fill it in"
   with a likely value just because the rest of the row has
   numbers.

ROW IDENTIFICATION:
- Return one entry per HANDWRITTEN SCORE ROW.
- For "name", return the literal handwritten text in the row's
  leftmost cell. Examples from real cards: "Cruz", "Mitch", "Clint",
  "Wilson", "P. Cruz", "Cruz, P", "PC", "Cruz (5)". Do NOT
  reformat. If unreadable, use "Row 1", "Row 2", ...
- Do NOT invent names. Names like "Patrick Cruz" / "Jonathan Wilson"
  (full first + last) are almost never what's written — golfers
  usually scribble a first name or last name only.

GROSS-vs-NET NOTATIONS — always return the GROSS (left number):
- "5/4" or "5 / 4" — gross 5, net 4. Return 5.
- "4/3", "5/3", "6/4" — return the LEFT number with HIGH confidence
  (the slash is unambiguous).
- "5(4)" or "5 (4)" — gross 5, net in parens. Return 5.
- A bare number with no annotation IS the gross.

SHAPE ANNOTATIONS — ignore the shape, read the digit:
- Circle around a number (birdie marker) → return the number, "high"
  confidence (the circle isolates the digit visually).
- Two concentric circles (eagle) → return the number inside.
- Square / rectangle around a number → return the number inside.
- Slash through a number → read the digit, ignore the slash.

LAYOUT:
- 18-hole cards usually split holes 1-9 (front) and 10-18 (back)
  across the card. Return scores in order 1, 2, ..., 18 even if
  visually they're in two halves.
- Use the printed hole-number column headers (1, 2, ..., 9 / 10,
  11, ..., 18) to anchor your column alignment. If a digit isn't
  clearly UNDER a hole-number header, it's probably not a hole
  score — return null + null.

FINAL SELF-CHECK BEFORE RETURNING:
- Look at your scores arrays. Did you return a flat row of 4s or
  5s? If yes, you pattern-filled. Re-read each cell.
- Are there any cells where you guessed but said "high"? Downgrade
  those to "low".
- Did you accidentally read a yardage row (numbers > 9 lined up)
  as scores? Drop those.
- Are your invariants right: scores[i]===null iff
  score_confidences[i]===null, both arrays same length?

Return ONLY the JSON object. No code fences, no prose.`;

/** Build the API request body with optional retry-hint text. */
function buildRequestBody(
  modelId: string,
  dataUrl: string,
  holes: 9 | 18,
  retryHint: string | null,
  temperature: number
) {
  return {
    model: modelId,
    response_format: { type: "json_object" as const },
    temperature,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `This card has ${holes} holes. Transcribe every ` +
              `handwritten score row you can see. Use the literal ` +
              `handwritten text for each name — no normalization, ` +
              `no invented names.` +
              (retryHint ? `\n\n${retryHint}` : "")
          },
          {
            type: "image_url",
            // detail:"high" is the critical flag for pencil
            // handwriting. Without it the API aggressively
            // downsamples and digits become unreadable.
            image_url: { url: dataUrl, detail: "high" as const }
          }
        ]
      }
    ]
  };
}

async function callOpenAI(
  apiKey: string,
  body: ReturnType<typeof buildRequestBody>
) {
  return await retry(
    async () => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`OCR upstream ${r.status}: ${text.slice(0, 200)}`);
      }
      return await r.json();
    },
    { attempts: 4, baseMs: 500 }
  );
}

/**
 * Strip a trailing handicap annotation from a player's name as the
 * model returned it. Real golf scorecards often write the player's
 * handicap right next to their name — "Cruz (5)", "Mitch (4)" — and
 * the model dutifully returns the literal text. The application's
 * fuzzy matcher then can't find "Cruz" in the player list because
 * it's looking up "Cruz (5)".
 *
 * Examples:
 *   "Cruz (5)"     → { name: "Cruz",        handicap: 5 }
 *   "P. Cruz (12)" → { name: "P. Cruz",     handicap: 12 }
 *   "Mitch"        → { name: "Mitch",       handicap: null }
 *   "Cruz 5"       → { name: "Cruz 5",      handicap: null }  (no parens — be conservative)
 *
 * Exported for tests. Pure function.
 */
export function stripHandicap(rawName: string): {
  name: string;
  handicap: number | null;
} {
  const trimmed = (rawName ?? "").trim();
  // Match a trailing "(<digits-or-decimal>)" with optional whitespace.
  // The capture group is the handicap.
  const m = trimmed.match(/^(.+?)\s*\((\d+(?:\.\d+)?)\)\s*$/);
  if (m) {
    return { name: m[1].trim(), handicap: parseFloat(m[2]) };
  }
  return { name: trimmed, handicap: null };
}

/**
 * Exported for unit tests in `tests/ocr-confidence.test.ts`. Not part
 * of the public API surface — consumers should call `ocr.parse()`.
 */
export function parseModelResponse(raw: any, holes: 9 | 18) {
  let parsed: any = null;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {
      parsed: null,
      rows: [] as Array<{
        name: string;
        scores: Array<number | null>;
        confidences: Array<CellConfidence>;
      }>
    };
  }
  const rows = (parsed?.players ?? []).map((p: any) => {
    const rawScores: any[] = Array.isArray(p?.scores) ? p.scores : [];
    const rawConfidences: any[] = Array.isArray(p?.score_confidences)
      ? p.score_confidences
      : [];
    const scores: Array<number | null> = Array.from(
      { length: holes },
      (_, i) => {
        const v = rawScores[i];
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        // Sanity: clamp obvious junk. A handwritten score of 11+ is
        // almost certainly a misread of a two-digit total bleeding
        // in, or two adjacent digits glommed together. Drop them as
        // a defense-in-depth on top of the prompt-side guidance.
        const rounded = Math.round(v);
        if (rounded < 1 || rounded > 12) return null;
        return rounded;
      }
    );
    const confidences: Array<CellConfidence> = Array.from(
      { length: holes },
      (_, i) => {
        if (scores[i] === null) return null;
        const c = rawConfidences[i];
        // Default to "low" when the model returned a score but
        // omitted confidence. Conservative — UI surfaces these for
        // review rather than auto-filling.
        if (c === "high") return "high";
        return "low";
      }
    );
    const rawName = String(p?.name ?? "");
    const { name: cleanedName } = stripHandicap(rawName);
    return {
      // Strip trailing "(N)" handicap so the fuzzy matcher can find
      // "Cruz" instead of trying to match "Cruz (5)". The original
      // text is preserved in the diagnostic payload via pre_coerce.
      name: cleanedName,
      scores,
      confidences
    };
  });
  return { parsed, rows };
}

function countCells(
  rows: Array<{ scores: Array<number | null> }>
): number {
  return rows.reduce(
    (sum, p) => sum + p.scores.filter((s) => s != null).length,
    0
  );
}

/**
 * Retry framing used when the first pass returned rows-but-zero-cells.
 * This is the classic "model gave up" failure mode — it produced
 * structurally valid output but every score is null. The second pass
 * uses a higher temperature + a focused user message addressing the
 * exact failure ("you returned all nulls — try again, the digits are
 * visible") so the model is much less likely to repeat the same path.
 */
const RETRY_HINT =
  `IMPORTANT: A previous attempt at this exact image returned all-null ` +
  `scores. That is the WRONG behavior. The handwritten digits on this ` +
  `card are visible to a human — they are visible to you too. Look ` +
  `again carefully at each row. Read the pencil scores literally. If a ` +
  `digit is at all legible, return it. Return null only for cells that ` +
  `are genuinely blank.`;

/**
 * Different retry hint, used when the first pass returned rows-with-
 * scores but the pattern detector flagged them as cross-row
 * templating (multiple players have the same score sequence). The
 * model fell back to "emit a plausible-looking golf score row"
 * instead of doing the visual work per row. This hint addresses
 * that failure mode directly and forces per-row independence.
 */
const TEMPLATING_RETRY_HINT =
  `IMPORTANT: Your previous attempt at this image returned NEAR-` +
  `IDENTICAL score sequences for multiple players. That is almost ` +
  `always a sign that you emitted "what a golf round LOOKS LIKE" ` +
  `instead of reading what each row actually says. Different players ` +
  `do NOT normally shoot the same number on every hole.\n\n` +
  `Reset and treat EACH PLAYER ROW INDEPENDENTLY:\n` +
  `1. Identify the four (or however many) handwritten score rows.\n` +
  `2. For each row in turn, read its cells left-to-right WITHOUT ` +
  `looking at other rows. The handwriting varies between players — ` +
  `their scores will too.\n` +
  `3. If two rows end up with nearly identical scores, you're ` +
  `pattern-filling again — re-read carefully.\n` +
  `4. When uncertain about a digit, return null + null. Empty cells ` +
  `are SAFE; wrong cells break the user's settlement.\n\n` +
  `Confidence calibration: most real-world handwritten cards have ` +
  `at least a few "low" cells. If every cell in your output is ` +
  `"high", you're almost certainly over-claiming.`;

export const openAIVisionOCR: ScorecardOCR = {
  async parse({ dataUrl, holes, model }) {
    const apiKey = process.env.OPENAI_API_KEY;
    const modelId = model ?? "gpt-4o";
    const calledAt = new Date().toISOString();
    const dataUrlBytes = dataUrl.length;
    if (!apiKey) {
      // Loud server-side warning so the silent no-op shows up in
      // Vercel Function logs even when nobody is watching the UI.
      // Patrick caught this once via the per-card diagnostics panel;
      // log + a structured diagnostics flag make it impossible to
      // miss a second time.
      const env =
        process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
      // eslint-disable-next-line no-console
      console.warn(
        `[ocr] OPENAI_API_KEY is not set (env=${env}). ` +
          `Upload returned no-op shape. Add the env var via Vercel ` +
          `→ Settings → Environment Variables and redeploy.`
      );
      return {
        players: [],
        _debug: {
          raw_text:
            "OPENAI_API_KEY is not set — OCR is a no-op. " +
            "Add it via Vercel → Settings → Environment Variables, " +
            "scope it to Production + Preview, then trigger a redeploy.",
          pre_coerce: null,
          post_coerce: null,
          data_url_bytes: dataUrlBytes,
          model: modelId,
          called_at: calledAt,
          no_player_hint: true,
          attempts: 0
        }
      };
    }

    // First attempt — temperature 0, no retry hint.
    const body1 = buildRequestBody(modelId, dataUrl, holes, null, 0);
    const j1 = await callOpenAI(apiKey, body1);
    const raw1 = j1.choices?.[0]?.message?.content;
    const { parsed: parsed1, rows: rows1 } = parseModelResponse(raw1, holes);

    // Decide if we need a second pass. Two trigger conditions:
    //   A) Empty-cells (rows but every cell null) → "gave up"
    //      failure. Use RETRY_HINT.
    //   B) Cross-row templating detected by pattern check → the
    //      classic "model emitted plausible-looking golf scores
    //      instead of reading the rows" failure mode. Use the
    //      TEMPLATING_RETRY_HINT.
    //
    // Skip retry for empty-array responses (model said "can't read")
    // and for partial-but-clean parses (already useful).
    const triggerA = rows1.length > 0 && countCells(rows1) === 0;
    let triggerB = false;
    if (rows1.length >= 2 && countCells(rows1) > 0) {
      const patterns = detectSuspiciousPatterns({
        rows: rows1.map((r: { name: string; scores: Array<number | null> }) => ({
          name: r.name,
          scores: r.scores
        }))
      });
      // Only fire on templating signals — not "matches_par" (server
      // doesn't have par data) or "low_variance" alone (could be a
      // real conservative round).
      triggerB = patterns.warnings.some(
        (w) =>
          w.type === "players_similar" ||
          w.type === "uniform_value" ||
          w.type === "front_back_identical"
      );
    }
    const needRetry = triggerA || triggerB;
    const retryHint = triggerA ? RETRY_HINT : TEMPLATING_RETRY_HINT;

    if (!needRetry) {
      return {
        players: rows1,
        _debug: {
          raw_text: typeof raw1 === "string" ? raw1 : JSON.stringify(raw1),
          pre_coerce: parsed1,
          post_coerce: rows1,
          data_url_bytes: dataUrlBytes,
          model: modelId,
          called_at: calledAt,
          no_player_hint: true,
          attempts: 1
        }
      };
    }

    // Second attempt — warmer temperature + a focused retry hint
    // addressing the specific failure mode detected on pass 1.
    const body2 = buildRequestBody(modelId, dataUrl, holes, retryHint, 0.4);
    const j2 = await callOpenAI(apiKey, body2);
    const raw2 = j2.choices?.[0]?.message?.content;
    const { parsed: parsed2, rows: rows2 } = parseModelResponse(raw2, holes);

    // Pick the better response.
    //
    // For trigger A (empty cells), "better" = more cells parsed.
    // For trigger B (templating), more cells isn't enough — a second
    // pass that's ALSO templated isn't an improvement. Score the
    // retry on (cells, no_templating). Templated retries get demoted.
    function templatingScore(rows: typeof rows1): number {
      if (rows.length < 2) return 0;
      const p = detectSuspiciousPatterns({
        rows: rows.map((r: { name: string; scores: Array<number | null> }) => ({
          name: r.name,
          scores: r.scores
        }))
      });
      return p.warnings.filter(
        (w) =>
          w.type === "players_similar" ||
          w.type === "uniform_value" ||
          w.type === "front_back_identical"
      ).length;
    }
    const cells1 = countCells(rows1);
    const cells2 = countCells(rows2);
    let winnerIs2: boolean;
    if (triggerB) {
      // Prefer the response with fewer templating warnings. Break
      // ties by cell count.
      const t1 = templatingScore(rows1);
      const t2 = templatingScore(rows2);
      winnerIs2 = t2 < t1 || (t2 === t1 && cells2 >= cells1);
    } else {
      winnerIs2 = cells2 >= cells1;
    }
    const winnerRows = winnerIs2 ? rows2 : rows1;
    const winnerParsed = winnerIs2 ? parsed2 : parsed1;
    const winnerRaw = winnerIs2 ? raw2 : raw1;

    return {
      players: winnerRows,
      _debug: {
        raw_text:
          typeof winnerRaw === "string" ? winnerRaw : JSON.stringify(winnerRaw),
        pre_coerce: winnerParsed,
        post_coerce: winnerRows,
        data_url_bytes: dataUrlBytes,
        model: modelId,
        called_at: calledAt,
        no_player_hint: true,
        attempts: 2,
        first_attempt_raw:
          typeof raw1 === "string" ? raw1 : JSON.stringify(raw1)
      }
    };
  }
};

export const ocr: ScorecardOCR = openAIVisionOCR;
