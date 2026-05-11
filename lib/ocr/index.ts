/**
 * Pluggable scorecard OCR. Default adapter: OpenAI gpt-4o vision.
 * If OPENAI_API_KEY is unset, returns a "blank" parse so the user can hand-type.
 *
 * Wraps the upstream call in `retry()` with exponential backoff so a transient
 * 429/5xx from OpenAI never bubbles up to the user.
 */
import { retry } from "../retry";

export interface ScorecardOCR {
  parse(input: { dataUrl: string; players: string[]; holes: 9 | 18 }): Promise<{
    players: Array<{ name: string; scores: Array<number | null> }>;
  }>;
}

const SYSTEM_PROMPT = `You read photos of paper golf scorecards. You will be given:
- a photo of a card
- the list of player display names that should appear on it (in any order)
- the number of holes (9 or 18)

Return ONLY JSON with this shape (no prose, no markdown fences):
{ "players": [ { "name": "<exactly as it appears on the card>", "scores": [n1, n2, ...] } ] }

IMPORTANT: extracting scores is your primary job. Return scores even when
the name doesn't match the provided list — the application has a manual
mapping step. Returning [null, null, ...] for every cell because you're
"unsure" wastes the upload. Read what's actually written.

ROW IDENTIFICATION (don't drop rows):
- Return one entry per HANDWRITTEN SCORE ROW on the card. If you see 4
  rows of numbers, return 4 entries.
- For "name", return the literal text written in that row's leftmost
  cell. Examples: "Pat", "P. Cruz", "Patrick C", "Cruz, P". Do not
  reformat or normalize. If the row's name cell is blank, use "Row 1",
  "Row 2", etc.
- Do NOT drop a row just because its name doesn't match the provided
  list — the user maps it themselves.

NUMBERS NEAR NAMES — these are NOT hole scores:
- Handicap index (e.g. "12.3"), course handicap (e.g. "14"), cart
  number, starting hole, "guest", a dollar amount — all common cells
  immediately right of the name. Skip them.
- Hole scores live UNDER the hole-number column headers (1, 2, ... 18).
  Use the column headers to align cells. If a number is in a column
  WITHOUT a hole-number header above it, it's not a score.

GROSS-VS-NET NOTATIONS — always return the GROSS:
- "5/4" or "5 / 4" — the LEFT number (5) is gross, right (4) is net. Return 5.
- "5\\4" — same, left is gross. Return 5.
- "5 net 4" — gross 5, return 5.
- "5(4)" or "5 (4)" — gross 5 with net in parens. Return 5.
- "G 5 / N 4" — gross is labeled. Return 5.
- Standalone numbers with no annotation are the gross. Return as-is.

SHAPE ANNOTATIONS — ignore the shape, read the number:
- Circles around a number (typically birdies, sometimes eagles) — return the
  number inside.
- Squares / rectangles around a number (typically bogeys / doubles) — return
  the number inside.
- Slashes through a number — read the number, ignore the slash.
- Two concentric circles (eagle) — return the number, not "2".

LAYOUT — handle scorecard structure:
- Skip columns labeled "OUT", "IN", "TOT", "Total", "Front", "Back",
  "Subtotal", or any 9-hole summary column. Only return per-hole cells.
- If the card has front 9 on one side and back 9 on another, return all 18
  in order 1, 2, ..., 9, 10, ..., 18.
- Par row, HCP/SI row, Yardage rows — ignore. Only player rows.
- Some cards have handicap or par columns interleaved (e.g. par row above
  each hole's score). Use the row labeled with the player's name only.

CONFIDENCE & UNCERTAINTY:
- The scores array length MUST equal the number of holes.
- Use null ONLY when the cell is genuinely blank or smudged beyond
  recognition.
- If a digit is hand-written but legible (even sloppily), READ IT. The
  user fixes typos themselves in the review screen. Returning a
  best-effort number is more useful than null.
- Common golf scores are 2-8. If your best read is "11" or "0", it's
  almost certainly wrong — return null.
- If the entire scorecard is unreadable to you, return an empty
  players array, NOT 4 entries with all-null scores.

NAME FIDELITY:
- Return the literal name text from the card. The application
  fuzzy-matches "Pat" → "Patrick Cruz" and "P. Cruz" → "Patrick Cruz"
  on its own. Your job is just to faithfully transcribe what's on the
  card.
`;

export const openAIVisionOCR: ScorecardOCR = {
  async parse({ dataUrl, players, holes }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { players: players.map((n) => ({ name: n, scores: new Array(holes).fill(null) })) };
    }
    const body = {
      model: "gpt-4o",
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Players: ${players.join(", ")}\nHoles: ${holes}` },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    };
    const j = await retry(async () => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const text = await r.text();
        // Surface the status code in the message so retry's predicate can match 429/5xx.
        throw new Error(`OCR upstream ${r.status}: ${text.slice(0, 200)}`);
      }
      return await r.json();
    }, { attempts: 4, baseMs: 500 });
    const raw = j.choices?.[0]?.message?.content;
    let parsed: any;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("OCR returned malformed JSON");
    }
    // Coerce to expected shape.
    const out = (parsed?.players ?? []).map((p: any) => ({
      name: String(p?.name ?? ""),
      scores: Array.from({ length: holes }, (_, i) => {
        const v = p?.scores?.[i];
        return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
      })
    }));
    return { players: out };
  }
};

export const ocr: ScorecardOCR = openAIVisionOCR;
