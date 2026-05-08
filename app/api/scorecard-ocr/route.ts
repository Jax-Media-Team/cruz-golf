import { NextResponse } from "next/server";
import { z } from "zod";
import { ocr } from "@/lib/ocr";

const Body = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  players: z.array(z.string()).min(1).max(8),
  holes: z.union([z.literal(9), z.literal(18)])
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const out = await ocr.parse(parsed.data);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "OCR failed" }, { status: 500 });
  }
}
