/**
 * Course-import OCR. Reads a photo of a scorecard and extracts the course
 * setup data: course name, tee names, pars per hole, stroke index, and
 * yardages per tee. NOT to be confused with `lib/ocr/index.ts` which reads
 * scored player rows during a round.
 *
 * Design choices:
 * - One photo can carry multiple tees (most printed cards list 3–5).
 *   The model returns each tee with its own yardage row.
 * - Pars and stroke indexes are shared across tees — we only return one set.
 *   (Ladies' SI is sometimes printed separately; if present, we capture it
 *   in `stroke_indexes_ladies`.)
 * - Rating/slope are usually printed but not always — return null when
 *   unclear and let the user fill them in.
 * - For ANY cell where two interpretations are plausible we return null.
 *   The reviewer UI flags nulls so the user knows to hand-fill them.
 */
import { retry } from "../retry";

export type CourseImportTee = {
  name: string;
  gender?: "men" | "women" | null;
  rating: number | null;
  slope: number | null;
  total_par: number | null;
  front_par: number | null;
  back_par: number | null;
  total_yardage: number | null;
  front_yardage: number | null;
  back_yardage: number | null;
  yardages: Array<number | null>; // length = holes
};

export type CourseImportResult = {
  course: {
    name: string | null;
    city: string | null;
    state: string | null;
  };
  holes: 9 | 18;
  pars: Array<number | null>; // length = holes
  stroke_indexes: Array<number | null>; // length = holes (men's)
  stroke_indexes_ladies: Array<number | null> | null; // optional, same length
  tees: CourseImportTee[];
  notes: string | null; // anything the model thought worth flagging
};

export interface CourseImportOCR {
  parse(input: { dataUrls: string[] }): Promise<CourseImportResult>;
}

const SYSTEM_PROMPT = `You read photos of paper golf scorecards and extract the course setup data.
You may receive one or more photos of the same card (front/back/inside flap). Treat them as one scorecard.

Return ONLY JSON with this exact shape (no prose, no markdown fences):
{
  "course": { "name": string|null, "city": string|null, "state": string|null },
  "holes": 9 | 18,
  "pars": number[]                    // length must equal "holes"
  "stroke_indexes": number[]          // length must equal "holes"; each unique 1..N where N=holes
  "stroke_indexes_ladies": number[] | null,  // optional separate ladies' SI
  "tees": [
    {
      "name": string,                 // e.g. "Black", "Blue", "White", "Gold", "Red", "Tournament", "Senior"
      "gender": "men" | "women" | null,
      "rating": number | null,        // course rating, e.g. 72.4
      "slope": number | null,         // slope rating, e.g. 132 (55..155)
      "total_par": number | null,
      "front_par": number | null,
      "back_par": number | null,
      "total_yardage": number | null,
      "front_yardage": number | null,
      "back_yardage": number | null,
      "yardages": number[] | null     // length must equal "holes"; null entries allowed for unreadable cells
    }
  ],
  "notes": string | null              // optional human-readable notes about your confidence
}

CRITICAL RULES:
- Use null for ANY cell that's unreadable, blank, or where two interpretations are plausible. Never invent numbers.
- The pars array length MUST equal "holes". The stroke_indexes array length MUST equal "holes" and contain each integer 1..holes exactly once. If you cannot determine the SI cleanly, return null entries — do NOT make them up.
- Each tee's "yardages" array length MUST equal "holes" (use null for blank cells).
- "name" for tees: prefer the marketing name printed on the card (Black, Blue, etc.); fall back to color only if no name is given.
- "gender": infer from the column header. If the card has a separate red/forward tee with a women's rating it's "women". Most others are "men". Use null if uncertain.
- Course rating is typically 60–80 and one decimal place; slope is 55–155.
- If the card shows only 9 holes, set "holes" to 9 and return 9-length arrays.
- If a tee block is missing rating/slope, that's fine — return null and the user will fill it in.

QUALITY > QUANTITY: It's far better to return null on a cell than to guess wrong. The user reviews everything before saving.`;

export const openAICourseImportOCR: CourseImportOCR = {
  async parse({ dataUrls }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Without a key, return a blank skeleton so the user can hand-fill.
      return blankResult(18);
    }
    if (!dataUrls.length) throw new Error("at least one image required");

    const body = {
      model: "gpt-4o",
      response_format: { type: "json_object" as const },
      // gpt-4o vision benefits from temperature 0 for structured extraction.
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                dataUrls.length > 1
                  ? `${dataUrls.length} photos of the same scorecard. Treat them as one card.`
                  : "Photo of a scorecard."
            },
            ...dataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "high" as const }
            }))
          ]
        }
      ]
    };

    const j = await retry(
      async () => {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Course-OCR upstream ${r.status}: ${text.slice(0, 200)}`);
        }
        return await r.json();
      },
      { attempts: 4, baseMs: 800 }
    );

    const raw = j.choices?.[0]?.message?.content;
    let parsed: any;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("Course-OCR returned malformed JSON");
    }
    return coerceResult(parsed);
  }
};

export const courseImportOcr: CourseImportOCR = openAICourseImportOCR;

// ---- helpers ----

function blankResult(holes: 9 | 18): CourseImportResult {
  return {
    course: { name: null, city: null, state: null },
    holes,
    pars: new Array(holes).fill(null),
    stroke_indexes: new Array(holes).fill(null),
    stroke_indexes_ladies: null,
    tees: [],
    notes: "OCR not available — fill in manually."
  };
}

function coerceResult(p: any): CourseImportResult {
  const holesRaw = p?.holes;
  const holes: 9 | 18 = holesRaw === 9 ? 9 : 18;
  const numOrNull = (v: any): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const intOrNull = (v: any): number | null => {
    const n = numOrNull(v);
    return n === null ? null : Math.round(n);
  };
  const arrOf = <T,>(arr: any, n: number, mapper: (v: any) => T | null): Array<T | null> => {
    const a = Array.isArray(arr) ? arr : [];
    return Array.from({ length: n }, (_, i) => (i < a.length ? mapper(a[i]) : null));
  };

  return {
    course: {
      name: typeof p?.course?.name === "string" ? p.course.name.trim() || null : null,
      city: typeof p?.course?.city === "string" ? p.course.city.trim() || null : null,
      state: typeof p?.course?.state === "string" ? p.course.state.trim() || null : null
    },
    holes,
    pars: arrOf(p?.pars, holes, intOrNull),
    stroke_indexes: arrOf(p?.stroke_indexes, holes, intOrNull),
    stroke_indexes_ladies:
      Array.isArray(p?.stroke_indexes_ladies)
        ? arrOf(p.stroke_indexes_ladies, holes, intOrNull)
        : null,
    tees: Array.isArray(p?.tees)
      ? p.tees
          .filter((t: any) => t && typeof t === "object")
          .map((t: any): CourseImportTee => ({
            name: typeof t?.name === "string" ? t.name.trim() : "",
            gender: t?.gender === "men" || t?.gender === "women" ? t.gender : null,
            rating: numOrNull(t?.rating),
            slope: intOrNull(t?.slope),
            total_par: intOrNull(t?.total_par),
            front_par: intOrNull(t?.front_par),
            back_par: intOrNull(t?.back_par),
            total_yardage: intOrNull(t?.total_yardage),
            front_yardage: intOrNull(t?.front_yardage),
            back_yardage: intOrNull(t?.back_yardage),
            yardages: arrOf(t?.yardages, holes, intOrNull)
          }))
      : [],
    notes: typeof p?.notes === "string" ? p.notes : null
  };
}

// ---- public validators reused by the reviewer UI ----

export type CourseImportValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validate a (possibly user-edited) CourseImportResult before save.
 * Returns errors that must be fixed (block save) and warnings that the
 * user can ignore.
 */
export function validateCourseImport(r: CourseImportResult): CourseImportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = r.holes;

  // Course name
  if (!r.course.name || r.course.name.length < 2) {
    errors.push("Course name is required.");
  }

  // Pars: every cell present, in 3..6
  if (r.pars.length !== n) errors.push(`Pars must have ${n} entries.`);
  for (let i = 0; i < n; i++) {
    const p = r.pars[i];
    if (p == null) errors.push(`Hole ${i + 1} par is missing.`);
    else if (p < 3 || p > 6) warnings.push(`Hole ${i + 1} par is ${p}, outside the usual 3–6 range.`);
  }

  // Stroke index: must be a permutation of 1..n
  const si = r.stroke_indexes;
  if (si.length !== n) errors.push(`Stroke index must have ${n} entries.`);
  const seen = new Set<number>();
  let siHasNull = false;
  for (let i = 0; i < n; i++) {
    const v = si[i];
    if (v == null) {
      siHasNull = true;
    } else {
      if (v < 1 || v > n) errors.push(`Hole ${i + 1} SI ${v} out of range.`);
      else if (seen.has(v)) errors.push(`Stroke index ${v} appears more than once.`);
      else seen.add(v);
    }
  }
  if (siHasNull) errors.push("Every hole needs a stroke index.");
  else if (seen.size !== n) errors.push("Stroke index must be 1..18 (or 1..9 for 9-hole) with no duplicates.");

  // Tees: at least one
  if (r.tees.length === 0) {
    errors.push("Add at least one tee.");
  }
  for (const t of r.tees) {
    if (!t.name) errors.push("A tee is missing its name.");
    if (t.rating != null && (t.rating < 50 || t.rating > 90))
      warnings.push(`${t.name || "Tee"} rating ${t.rating} is unusual (expected 50–90).`);
    if (t.slope != null && (t.slope < 55 || t.slope > 155))
      warnings.push(`${t.name || "Tee"} slope ${t.slope} is outside USGA range (55–155).`);
    if (t.rating == null) warnings.push(`${t.name || "Tee"}: course rating is blank.`);
    if (t.slope == null) warnings.push(`${t.name || "Tee"}: slope is blank.`);
    const blanks = t.yardages.filter((y) => y == null).length;
    if (blanks > 0) warnings.push(`${t.name || "Tee"}: ${blanks} hole yardage(s) blank.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
