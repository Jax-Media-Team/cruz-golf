import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { SpectatorView } from "./spectator-view";

// Public, token-keyed leaderboard. No auth required. Reads through service role
// behind the scenes so RLS doesn't block anonymous access.

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
  searchParams: Promise<{ token?: string }>;
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
    .select("id, spectator_token, date, holes, status, courses(name)")
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

  return <SpectatorView round={round as any} rps={rps ?? []} scores={scores ?? []} />;
}
