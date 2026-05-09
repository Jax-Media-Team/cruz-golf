import { HELP_ENTRIES } from "./help-knowledge";

/**
 * Cruz Golf in-app help LLM bridge.
 *
 * Calls whichever provider is configured via env:
 *   ANTHROPIC_API_KEY  -> Claude Haiku 4.5 (preferred)
 *   GEMINI_API_KEY     -> Google Gemini 1.5 Flash (free tier)
 *
 * If neither is configured we throw so the caller can fall back to the
 * static FAQ search. Never streams (yet) — single-shot JSON response keeps
 * the route handler simple and edge-friendly.
 */

export type HelpAskResult = {
  answer: string;
  provider: "anthropic" | "gemini";
};

const SYSTEM_PROMPT = buildSystemPrompt();

function buildSystemPrompt(): string {
  // Build a single condensed knowledge document the model can quote.
  const faq = HELP_ENTRIES.map(
    (e, i) => `${i + 1}. Q: ${e.q}\n   A: ${e.a}`
  ).join("\n\n");
  return `You are the in-app help assistant for **Cruz Golf**, a mobile-first golf scoring + games app for private foursomes, member events, and small leagues.

Be concise. Default to 2–4 sentences. Use bullet points for steps. Never invent features. If you don't know, say so plainly and suggest the user ask the round commissioner. Do not pad with disclaimers.

# How Cruz Golf works (ground truth — answer from this)

## Scoring
- Round leaderboard updates live as scores are entered.
- Two entry modes: "Score the group" (one device for the whole foursome) or per-player (each phone).
- Desktop spreadsheet grid available on /rounds/[id]/score-group when on a wider screen.
- Scores persist to localStorage queue if the network drops; drains automatically on focus/online. Failed saves can be retried or discarded from the red banner.

## Games (multiple can run simultaneously per round)
- **Skins** — pot mode (default): every player buys in, total pot is divided EQUALLY among the skins won. 4 skins on $80 pot = $20/skin. Zero skins = pot returns. Fixed-per-skin mode also available.
- **Skins ties** — pot mode: carry (no skin awarded) or nullify. Fixed mode: split, carry, or nullify.
- **Skins variants** — gross, net (handicap-adjusted), Canadian (requires birdie to validate the skin).
- **Nassau** — front 9, back 9, overall. Match-play or stroke-play. 2-player or team. Front/back/overall stakes configurable separately. (Auto-press at 2-down is not yet implemented.)
- **Best ball (gross/net)** — lowest of two partners' scores per hole; team total wins.
- **Aggregate (gross/net)** — sum of all partners' scores per hole; lowest total team wins.
- **6-6-6** — exactly 4 players, partners rotate every 6 holes (AB vs CD, AC vs BD, AD vs BC). 18-hole only.
- **Closest-to-pin / Long drive / Custom side bets** — manual winner entry per configured hole.

## Handicaps (WHS 2024)
- Course Handicap = round(HI × Slope/113 + (CR − Par)).
- Playing Handicap = round(Course Handicap × allowance%).
- Strokes are distributed by hole stroke index — hardest holes (SI 1) first.
- Plus indexes (e.g. +1.4) are stored as negative numbers and give strokes back on the easiest holes.
- Type "+1.4" anywhere there's an HI input to set a plus index.

## Wagers + settlement
- Every game can have a stake. If any game has stakes, every invited player must confirm wagers before scoring.
- After finalize, settlement runs the minimum-flow algorithm — the fewest possible Venmo transfers to reconcile everyone.
- Each settlement row has a Venmo deep-link with the amount + note prefilled.

## Rounds + invites + access
- Round access modes: "invited" (per-person invite token) or "open_to_group" (any group member).
- Each round has a 4-digit PIN; players join via /rounds/[id]/join.
- Spectator-only public link with a token (no PIN, no scoring).
- Group commissioners can score on any player; invited players can only score after wager-ack.

## Courses
- Each course has 1+ tees. Each tee has its own par, rating, slope, and per-hole par/SI/yardage.
- /courses/[id] expands tees inline for hole-by-hole editing.
- "Copy par + SI to all tees" applies one tee's hole data across the course.

## Roles
- **Platform Admin / Super Admin**: sees every group, user, round, course on the platform.
- **Group Commissioner**: edits their own group's rounds, players, courses, games. Can override scores.
- **Player**: enters their own scores; needs invite + wager ack.
- **Guest**: ad-hoc players added to a round without an account.
- **Spectator**: read-only via the public link.

# FAQ index (extra detail you can paraphrase)
${faq}

# Style
- Direct, concrete, clubhouse-tone — like a pro shop guy who knows the menu.
- If a question is outside the app (rules of golf, swing tips, course recommendations), redirect: "That's outside what I can help with — try the USGA rules app or your local pro."
- Tail every answer with at most one suggested follow-up like "Want me to show you where that lives?" — only if helpful.`;
}

export function isHelpLlmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || !!process.env.GEMINI_API_KEY;
}

export async function askHelpLlm(question: string): Promise<HelpAskResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error("Empty question");

  // Prefer Anthropic if configured.
  if (process.env.ANTHROPIC_API_KEY) {
    return askAnthropic(trimmed);
  }
  if (process.env.GEMINI_API_KEY) {
    return askGemini(trimmed);
  }
  throw new Error("No help LLM configured");
}

async function askAnthropic(question: string): Promise<HelpAskResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }]
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const answer =
    (json.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n")
      .trim() || "No answer.";
  return { answer, provider: "anthropic" };
}

async function askGemini(question: string): Promise<HelpAskResult> {
  // Gemini 1.5 Flash via the public generativelanguage API. Free tier:
  // 15 RPM / 1500/day / 1M tokens/day — plenty for in-app help.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 600, temperature: 0.4 },
      contents: [{ role: "user", parts: [{ text: question }] }]
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const answer = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim() || "No answer.";
  return { answer, provider: "gemini" };
}
