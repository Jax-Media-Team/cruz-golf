import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// OAuth callback: Supabase redirects here after Google sign-in.
// Exchanges the code for a session and routes the user into the app.
// If the user has no profile/group yet (first OAuth sign-in), bootstraps both.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/dashboard";
  const sb = await supabaseServer();

  if (code) {
    await sb.auth.exchangeCodeForSession(code);
  }

  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    // Ensure profile exists.
    const { data: existingProfile } = await sb
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!existingProfile) {
      const fallbackName =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        user.email?.split("@")[0] ||
        "Golfer";
      const avatar =
        (user.user_metadata?.avatar_url as string) ||
        (user.user_metadata?.picture as string) ||
        null;
      await sb.from("profiles").upsert({ id: user.id, display_name: fallbackName, avatar_url: avatar });
    }

    // Ensure they have at least one group (only if NOT joining via invite).
    const isInviteFlow = next.includes("/join");
    if (!isInviteFlow) {
      const { data: groups } = await sb
        .from("groups")
        .select("id")
        .eq("owner_id", user.id)
        .limit(1);
      if (!groups || groups.length === 0) {
        const displayName =
          (user.user_metadata?.full_name as string) ||
          user.email?.split("@")[0] ||
          "Cruz";
        const { data: g } = await sb
          .from("groups")
          .insert({ name: `${displayName}'s Group`, owner_id: user.id })
          .select("id")
          .single();
        if (g) {
          await sb.from("group_members").insert({
            group_id: g.id,
            profile_id: user.id,
            player_id: user.id,
            role: "commissioner"
          });
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, req.url));
}
