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
{ "players": [ { "name": "<one of the provided names>", "scores": [n1, n2, ...] } ] }

Rules:
- The scores array length MUST equal the number of holes.
- Use null for any cell that's unreadable, blank, or unclear. Never invent numbers.
- Match each row to the closest provided name; if you cannot match a row, omit it.
- Trust digits that are clearly written. If two interpretations are plausible, return null.
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
