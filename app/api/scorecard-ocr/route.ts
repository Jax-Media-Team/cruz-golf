import { NextResponse } from "next/server";
import { z } from "zod";
import { ocr } from "@/lib/ocr";

const Body = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  // `players` is now optional — the OCR pipeline no longer passes it
  // to the model (it caused name hallucination). We still accept the
  // field so older clients keep working and so the diagnostics layer
  // can echo "what the round expected" alongside the model output.
  players: z.array(z.string()).min(0).max(8).optional(),
  holes: z.union([z.literal(9), z.literal(18)]),
  /** Optional model override — useful for A/B testing newer vision
   *  models without touching the deployed default. */
  model: z.string().min(1).max(64).optional()
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 }
      );
    const out = await ocr.parse({
      dataUrl: parsed.data.dataUrl,
      players: parsed.data.players ?? [],
      holes: parsed.data.holes,
      model: parsed.data.model
    });
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "OCR failed" },
      { status: 500 }
    );
  }
}
