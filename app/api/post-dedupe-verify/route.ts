import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Post-dedupe verification:
 *   1. List Patrick's group's courses (alive + archived) to confirm
 *      exactly one alive JGCC remains.
 *   2. Find guest players in his group whose email matches a real
 *      auth.users row — the candidates fn_find_guest_link_candidates
 *      would surface in the UI.
 *
 * Allowlisted to Patrick's emails. Removed after the incident.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOW = new Set(["pcruz@stetson.edu", "pcruz@jaxmediateam.com"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const emailRaw = (url.searchParams.get("email") ?? "pcruz@stetson.edu").toLowerCase();
  if (!ALLOW.has(emailRaw)) {
    return NextResponse.json({ error: "email not in allowlist" }, { status: 403 });
  }
  const sb = supabaseAdmin();

  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => (x.email ?? "").toLowerCase() === emailRaw);
  if (!u) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const { data: members } = await sb
    .from("group_members")
    .select("group_id")
    .eq("profile_id", u.id);
  const groupId = members?.[0]?.group_id;
  if (!groupId) return NextResponse.json({ error: "no group" }, { status: 404 });

  // Group's courses, alive + archived.
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, deleted_at, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  const aliveCourses = (courses ?? []).filter((c: any) => !c.deleted_at);
  const archivedCourses = (courses ?? []).filter((c: any) => !!c.deleted_at);

  // Group's players (alive only) with profile_id status.
  const { data: players } = await sb
    .from("players")
    .select("id, display_name, email, is_guest, profile_id, deleted_at")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("display_name");

  // Guest-link candidates: alive guest players (profile_id is null) whose
  // email matches a real auth.users row.
  const guestPlayers = (players ?? []).filter(
    (p: any) => p.profile_id == null && p.email
  );
  const candidates = [];
  for (const g of guestPlayers as any[]) {
    const match = list.users.find(
      (x) => (x.email ?? "").toLowerCase() === g.email.toLowerCase()
    );
    if (match) {
      candidates.push({
        player_id: g.id,
        player_name: g.display_name,
        player_email: g.email,
        candidate_user_id: match.id,
        candidate_user_email: match.email
      });
    }
  }

  // Also: find players named like Ben Franklin / Luis Rivera / Kyle Knopsnyder
  // for the report — even if they don't have email, we want to know their
  // current profile_id status.
  const lookFor = ["ben franklin", "luis rivera", "kyle knopsnyder"];
  const namedReport = (players ?? [])
    .filter((p: any) =>
      lookFor.some((n) => (p.display_name as string).toLowerCase().includes(n))
    )
    .map((p: any) => ({
      name: p.display_name,
      id: p.id,
      email: p.email,
      is_guest: p.is_guest,
      profile_id: p.profile_id,
      has_link_candidate: !!candidates.find((c) => c.player_id === p.id)
    }));

  return NextResponse.json({
    group_id: groupId,
    courses_summary: {
      alive: aliveCourses.length,
      archived: archivedCourses.length,
      alive_jgcc: aliveCourses.filter((c: any) =>
        (c.name as string).toLowerCase().includes("jacksonville golf")
      ).length,
      alive_jgcc_id: aliveCourses.find((c: any) =>
        (c.name as string).toLowerCase().includes("jacksonville golf")
      )?.id ?? null
    },
    players_summary: {
      total_alive: (players ?? []).length,
      guests: (players ?? []).filter((p: any) => p.is_guest).length,
      linked_to_profile: (players ?? []).filter((p: any) => p.profile_id != null).length
    },
    link_candidates: candidates,
    named_report: namedReport
  });
}
