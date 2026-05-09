import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Auth callback. Two paths land here:
 *   1. Google (or other) OAuth: ?code=...&next=/dashboard
 *   2. Email-confirmation link from a fresh signup: ?code=...&next=/onboarding
 *
 * Both exchange the code for a session, then ensure the user has a profile
 * + group via the SECURITY DEFINER fn_bootstrap_account RPC. If the RPC
 * fails (e.g. the migration hasn't run for some reason), we still let them
 * into /onboarding which surfaces a friendly form.
 *
 * The route always issues a 303 redirect so the browser GETs the next
 * page even if we ever switch from GET to POST.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/dashboard";
  const sb = await supabaseServer();

  if (code) {
    const { error: exchangeErr } = await sb.auth.exchangeCodeForSession(code);
    if (exchangeErr) {
      // Send them to /login with a helpful note. Don't dump raw error to URL.
      return NextResponse.redirect(
        new URL("/login?signedOut=1&authErr=1", req.url),
        { status: 303 }
      );
    }
  }

  const {
    data: { user }
  } = await sb.auth.getUser();

  if (!user) {
    // No code, no session — bounce to login.
    return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  }

  // Bootstrap profile + group if missing. fn_bootstrap_account is idempotent
  // on the profile (upsert) and only creates a group if one doesn't already
  // exist for this caller. Skip when joining via invite (caller will join an
  // existing group, not create their own).
  const isInviteFlow = next.includes("/join");
  if (!isInviteFlow) {
    const { data: existingGroups } = await sb.from("groups").select("id").limit(1);
    if (!existingGroups || existingGroups.length === 0) {
      const fallbackName =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        [user.user_metadata?.first_name, user.user_metadata?.last_name]
          .filter(Boolean)
          .join(" ") ||
        user.email?.split("@")[0] ||
        "Golfer";
      const { error: bsErr } = await sb.rpc("fn_bootstrap_account", {
        p_display_name: fallbackName,
        p_group_name: ""
      });
      if (bsErr) {
        // Send them to /onboarding so they can finish setup manually.
        return NextResponse.redirect(
          new URL("/onboarding?bootstrapErr=1", req.url),
          { status: 303 }
        );
      }
    }
  }

  // If this was an email confirmation (next=/onboarding), pass a flag through
  // so the dashboard can show "Email confirmed!" briefly.
  return NextResponse.redirect(new URL(next, req.url), { status: 303 });
}
