import { NextResponse } from "next/server";
import { z } from "zod";
import { ocr } from "@/lib/ocr";
import { supabaseServer } from "@/lib/supabase/server";

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

/**
 * Crude per-user rate limit. The OpenAI vision call costs real money;
 * a single user mashing Retry could burn through a chunk of the
 * budget. 30 calls per 5-minute window is generous (each Retry is
 * one user-initiated action and Patrick's typical session caps at
 * a handful) while still preventing an obvious DoS. In-memory map
 * is fine — Vercel serverless restarts reset it, which is desired
 * (rate limit is best-effort, not strict).
 */
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const recentCalls = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const prior = (recentCalls.get(userId) ?? []).filter((t) => t > cutoff);
  if (prior.length >= RATE_LIMIT_MAX) {
    recentCalls.set(userId, prior);
    return true;
  }
  prior.push(now);
  recentCalls.set(userId, prior);
  // Drop old entries opportunistically to keep the map bounded.
  if (recentCalls.size > 5000) {
    for (const [k, v] of recentCalls) {
      if (v.length === 0 || v[v.length - 1] < cutoff) {
        recentCalls.delete(k);
      }
    }
  }
  return false;
}

export async function POST(req: Request) {
  try {
    // 1. Auth gate — anyone with the URL was burning OpenAI budget.
    //    Caught in code review 2026-05-12.
    const sb = await supabaseServer();
    const {
      data: { user }
    } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // 2. Per-user rate limit.
    if (isRateLimited(user.id)) {
      return NextResponse.json(
        {
          error:
            "OCR rate limit hit (30 calls per 5 min). Wait a bit, then try again — or type scores by hand in the grid."
        },
        { status: 429 }
      );
    }

    // 3. Validate body.
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
