import { NextResponse } from "next/server";
import { z } from "zod";
import { courseImportOcr } from "@/lib/ocr/course-import";

/**
 * POST /api/course-import-ocr
 *
 * Body: { dataUrls: string[] }   // 1..3 base64 image data URLs of the same scorecard
 * Returns: CourseImportResult (see lib/ocr/course-import.ts)
 *
 * Auth note: this endpoint costs OpenAI credits per call. We require the
 * caller to be a signed-in Cruz Golf user but don't otherwise rate-limit
 * — abuse mitigation is on the backlog.
 */

// Allow up to 12 MB / 3 photos per request. ~4 MB per photo is reasonable
// for a phone camera; larger gets compressed client-side before upload.
export const maxDuration = 60;

const Body = z.object({
  dataUrls: z
    .array(z.string().startsWith("data:image/"))
    .min(1)
    .max(3)
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const out = await courseImportOcr.parse(parsed.data);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Course-import OCR failed" },
      { status: 500 }
    );
  }
}
