import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * POST → 303 See Other → GET /login.
 *
 * This used to default to 307, which preserves the POST method. The browser
 * then POSTed to /login, which is a GET-only page → 405 → blank page. 303
 * forces the browser to issue a fresh GET on the new URL.
 *
 * Also handle GET so accidentally hitting /auth/signout in a tab still
 * signs the user out cleanly.
 */
async function doSignOut(req: Request) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login?signedOut=1", req.url), { status: 303 });
}

export async function POST(req: Request) {
  return doSignOut(req);
}

export async function GET(req: Request) {
  return doSignOut(req);
}
