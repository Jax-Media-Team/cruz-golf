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
    players: Array<{ name: string; scores: Array<number | null> }>;
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
Your ONLY job is to transcribe what you can see in the image. The
application handles fuzzy name matching itself — you must NOT invent
names from any external context. Read the card.

Return ONLY JSON with this shape (no prose, no markdown fences):
{ "players": [ { "name": "<exact literal text from the card>", "scores": [n1, n2, ..., n18] } ] }

CRITICAL — DO NOT HALLUCINATE:
- If the card has pencil writing you cannot read for a row's leftmost
  cell, use "Row 1", "Row 2", etc. NEVER invent a name.
- Likewise, never invent scores. Use null only for cells that are
  genuinely blank or smudged beyond legibility.
- If the entire card is unreadable, return an empty players array.

ROW IDENTIFICATION:
- Return one entry per HANDWRITTEN SCORE ROW. If you see 4 rows of
  pencil scores, return 4 entries — even if some are partial.
- For "name", return the literal handwritten text in that row's
  leftmost cell. Examples of what real cards have written:
  "Cruz", "Mitch", "Clint", "Wilson", "P. Cruz", "Cruz, P",
  "Patrick", "PC", "Cruz (5)" (the (5) is the player's handicap,
  include it verbatim). Do NOT reformat or normalize.

WHAT IS A SCORE ROW vs WHAT TO IGNORE:
- Score rows are HANDWRITTEN in pencil/pen, in the area below the
  printed hole-number column headers (1, 2, ..., 18).
- IGNORE these printed rows: "Par", "Men's HCP", "HCP", "SI",
  "Yardage", any tee row labeled "Black"/"Gold"/"Silver"/"Jade"/
  "Cranberry"/"Blue"/"White" (these contain printed yardages, not
  scores), "Ladies' HCP".
- IGNORE the "OUT", "IN", "TOT", "Total", "Front", "Back" columns —
  those are summary cells, not per-hole scores. Some cards have
  handwritten totals there (e.g. "39", "41", "80") — skip them.
- IGNORE a column labeled "+/−" — that's a running par-relative
  count, not a hole score.

NUMBERS NEAR NAMES — these are NOT hole scores:
- A "(5)", "(4)", "(2)", "(1)" immediately to the right of the name is
  the player's HANDICAP. Include it in the "name" text but DO NOT
  treat the digit as the hole-1 score.
- A standalone "12.3" near the name is a handicap index. Skip it.
- Hole scores live UNDER the hole-number column headers (1..18). Use
  those column headers to align cells. If a number is in a column
  WITHOUT a hole-number header above it, it's not a score.

GROSS-vs-NET NOTATIONS — always return the GROSS:
- "5/4" or "5 / 4" — gross 5, net 4. Return 5.
- "5\\4" — gross 5. Return 5.
- "4/3", "5/3", "6/4" — return the LEFT number.
- "5(4)" or "5 (4)" — gross 5, net in parens. Return 5.
- "G 5 / N 4" — return 5.
- "5 net 4" — return 5.
- A bare number with no annotation IS the gross. Return as-is.

SHAPE ANNOTATIONS — ignore the shape, read the digit:
- Circle around a number (birdie marker) → return the number inside.
- Two concentric circles (eagle) → return the number, not "2".
- Square / rectangle around a number (bogey or worse) → return the
  number inside.
- Slash through a number → read the digit, ignore the slash.
- "X" through a number → likely a "scratched-out correction"; read
  the FINAL legible number that replaced it. If a number has an "X"
  next to it like "5X", treat the "X" as a separator/annotation and
  return 5.

LAYOUT — handle both halves of an 18-hole card:
- Holes 1-9 usually appear in one half; 10-18 in the other half. If
  the photo shows both halves, return scores in order 1, 2, ..., 18.
- Par row, HCP/SI row, Yardage rows are printed (not handwritten) —
  IGNORE them entirely.

CONFIDENCE & UNCERTAINTY — this is the most-broken part of past runs:
- The "scores" array length MUST equal the number of holes.
- Common golf scores are 2-9. If your best read is "11" or "0", it's
  almost certainly wrong — return null for that cell.
- If a digit is hand-written but legible (even sloppily), READ IT.
  Returning your best-effort number is much more useful than null —
  the user fixes typos themselves in the review screen below.
- Returning [null, null, ...] for an entire row because you're
  "unsure" is the WRONG behavior. Do the visual work. If the
  handwriting is at all readable, transcribe.
- It is far better to return a row with 12 correct numbers and 6
  wrong ones than 0 numbers because of uncertainty. The user reviews.

FINAL CHECKS BEFORE RETURNING:
- Did you actually look at the pixels, or did you fall back to a
  template? If you returned generic English names for the rows,
  STOP — the card had handwriting. Re-read the leftmost cell of
  each row.
- Did every row return all-null scores? If so, you didn't read the
  card. Try again. Real golf scorecards have numbers visible to a
  human; you can see them too.

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

function parseModelResponse(raw: any, holes: 9 | 18) {
  let parsed: any = null;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { parsed: null, rows: [] as Array<{ name: string; scores: Array<number | null> }> };
  }
  const rows = (parsed?.players ?? []).map((p: any) => ({
    name: String(p?.name ?? ""),
    scores: Array.from({ length: holes }, (_, i) => {
      const v = p?.scores?.[i];
      return typeof v === "number" && Number.isFinite(v)
        ? Math.round(v)
        : null;
    })
  }));
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

    // Decide if we need a second pass. Auto-retry ONLY when:
    //   - we got at least one row back (so the model produced
    //     structured output), AND
    //   - every cell across all rows is null (the "gave up" signal).
    // This avoids doubling the API spend on:
    //   - empty-array responses (model said "I can't read this") —
    //     a retry won't help, the image is unreadable.
    //   - partial parses (some cells filled) — already useful; the
    //     manual Retry button covers improvement attempts.
    const needRetry = rows1.length > 0 && countCells(rows1) === 0;

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

    // Second attempt — slightly warmer temperature + the
    // "you returned all nulls last time" addressing.
    const body2 = buildRequestBody(modelId, dataUrl, holes, RETRY_HINT, 0.4);
    const j2 = await callOpenAI(apiKey, body2);
    const raw2 = j2.choices?.[0]?.message?.content;
    const { parsed: parsed2, rows: rows2 } = parseModelResponse(raw2, holes);

    // Use the better of the two responses (more cells wins). Tie
    // goes to the retry since that's our "the model actually looked"
    // attempt.
    const cells1 = countCells(rows1);
    const cells2 = countCells(rows2);
    const winnerIs2 = cells2 >= cells1;
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
