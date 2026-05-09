import { NextResponse } from "next/server";
import { askHelpLlm, isHelpLlmConfigured } from "@/lib/help-llm";

export const dynamic = "force-dynamic";
// Use the node runtime so we can call out to LLM providers from server fetch.
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isHelpLlmConfigured()) {
    return NextResponse.json({ error: "no_llm" }, { status: 501 });
  }
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const question = (body.question ?? "").toString().trim();
  if (!question) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (question.length > 1000) {
    return NextResponse.json({ error: "too_long" }, { status: 400 });
  }
  try {
    const result = await askHelpLlm(question);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
