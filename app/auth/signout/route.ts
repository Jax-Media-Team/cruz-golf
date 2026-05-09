import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  // Build the redirect from the request URL so we always land on the same
  // origin the user is actually on, even when APP_URL isn't set in env.
  return NextResponse.redirect(new URL("/login", req.url));
}
