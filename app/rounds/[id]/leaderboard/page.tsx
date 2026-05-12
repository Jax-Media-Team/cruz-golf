import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { SpectatorView } from "./spectator-view";
import { supabaseServer } from "@/lib/supabase/server";

// Public, token-keyed leaderboard. No auth required. Reads through service role
// behind the scenes so RLS doesn't block anonymous access.
//
// Admin observability path (?adminMode=1): when a Platform Admin reaches
// this page from /admin, we additionally verify their admin status server-
// side and render the AdminSpectatorBanner. This is NOT impersonation —
// the admin's own session is unchanged, the page is read-only by design,
// and the data path is the same token-keyed public spectator query.

export async function generateMetadata({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sp = await searchParams;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: round } = await sb
    .from("rounds")
    .select("id, spectator_token, date, courses(name)")
    .eq("id", id)
    .single();
  if (!round || (sp.token && round.spectator_token !== sp.token)) {
    return { title: "Cruz Golf" };
  }
  const courseName = (round as any).courses?.name ?? "Round";
  const title = `${courseName} · ${round.date}`;
  const ogImage = `/api/share/round/${id}/image?token=${round.spectator_token}`;
  return {
    title,
    description: `Live leaderboard at ${courseName}. Cruz Golf.`,
    openGraph: {
      title,
      description: `Live leaderboard · Cruz Golf`,
      images: [{ url: ogImage, width: 1200, height: 630 }]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: `Live leaderboard · Cruz Golf`,
      images: [ogImage]
    }
  };
}

export default async function PublicLeaderboard({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; adminMode?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const token = sp.token;
  if (!token) redirect("/");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: round } = await sb
    .from("rounds")
    .select("id, spectator_token, date, holes, status, group_id, courses(name), groups(name)")
    .eq("id", id)
    .single();
  if (!round || round.spectator_token !== token) redirect("/");

  const { data: rps } = await sb
    .from("round_players")
    .select("id, course_handicap, playing_handicap, team_id, display_order, players(display_name), course_tees(course_holes(hole_number, par, stroke_index))")
    .eq("round_id", id)
    .order("display_order");

  const { data: scores } = await sb
    .from("scores")
    .select("round_player_id, hole_number, gross")
    .in("round_player_id", (rps ?? []).map((r: any) => r.id));

  // Admin observability mode: only honored when the *signed-in* user is a
  // Platform Admin. The flag in the URL alone isn't enough — we re-check
  // server-side via the admin's own auth context (NOT the service-role
  // client) so a regular user can't spoof the banner by appending the
  // query param. If the check fails, we silently fall back to the normal
  // public spectator surface.
  let adminMode = false;
  let isAuthenticatedViewer = false;
  try {
    const userSb = await supabaseServer();
    const { data: { user } } = await userSb.auth.getUser();
    if (user) {
      isAuthenticatedViewer = true;
      if (sp.adminMode === "1") {
        const { data: isAdmin } = await userSb.rpc("fn_is_platform_admin");
        adminMode = !!isAdmin;
      }
    }
  } catch {
    adminMode = false;
    isAuthenticatedViewer = false;
  }

  return (
    <SpectatorView
      round={round as any}
      rps={rps ?? []}
      scores={scores ?? []}
      adminMode={adminMode}
      // When the viewer is signed in, the spectator URL is essentially
      // an extra hop — they should be able to bounce back to /dashboard
      // (or /rounds/[id]) without closing the tab. Patrick: "opens a
      // leaderboard that cannot be exited. No back, no other buttons."
      isAuthenticatedViewer={isAuthenticatedViewer}
      groupName={(round as any).groups?.name ?? null}
    />
  );
}
