import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Combined diagnostic — course state + guest-link candidates. Used to
 * close out the 2026-05-10 production incident in a single round-trip.
 * Removed in the cleanup commit immediately after verification.
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
  const groupId = members?.[0]?.group_id ?? null;
  if (!groupId) return NextResponse.json({ error: "no group" }, { status: 404 });

  // Group's courses (alive + archived).
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, group_id, is_template, deleted_at, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  const courseDetail = await Promise.all(
    (courses ?? []).map(async (c: any) => {
      const { data: tees } = await sb.from("course_tees").select("id").eq("course_id", c.id);
      const teeIds = (tees ?? []).map((t: any) => t.id);
      const safeIds = teeIds.length > 0 ? teeIds : ["00000000-0000-0000-0000-000000000000"];
      const [{ count: holeCount }, { count: roundCount }] = await Promise.all([
        sb.from("course_holes").select("*", { head: true, count: "exact" }).in("tee_id", safeIds),
        sb.from("rounds").select("*", { head: true, count: "exact" }).eq("course_id", c.id)
      ]);
      return {
        ...c,
        tee_count: teeIds.length,
        hole_count: holeCount ?? 0,
        round_count: roundCount ?? 0
      };
    })
  );

  // Players + guest-link candidates.
  const { data: players } = await sb
    .from("players")
    .select("id, display_name, email, is_guest, profile_id, deleted_at")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("display_name");

  const guestPlayers = (players ?? []).filter(
    (p: any) => p.profile_id == null && p.email
  );
  const linkCandidates = [];
  for (const g of guestPlayers as any[]) {
    const match = list.users.find(
      (x) => (x.email ?? "").toLowerCase() === g.email.toLowerCase()
    );
    if (match) {
      linkCandidates.push({
        player_id: g.id,
        player_name: g.display_name,
        player_email: g.email,
        candidate_user_id: match.id,
        candidate_user_email: match.email
      });
    }
  }

  // Named lookups for the report (Ben/Luis/Kyle).
  const lookFor = ["ben franklin", "luis rivera", "kyle knopsnyder"];
  const namedReport = (players ?? [])
    .filter((p: any) => lookFor.some((n) => (p.display_name as string).toLowerCase().includes(n)))
    .map((p: any) => {
      const cand = linkCandidates.find((c) => c.player_id === p.id) ?? null;
      return {
        name: p.display_name,
        id: p.id,
        email: p.email,
        is_guest: p.is_guest,
        profile_id: p.profile_id,
        link_candidate: cand
          ? {
              user_id: cand.candidate_user_id,
              user_email: cand.candidate_user_email
            }
          : null,
        // No-email reason: if email missing, can't auto-match
        why_no_candidate: !p.email
          ? "no email on file"
          : cand
          ? null
          : "email doesn't match any auth.users row"
      };
    });

  return NextResponse.json({
    group_id: groupId,
    courses_summary: {
      alive: courseDetail.filter((c: any) => !c.deleted_at).length,
      archived: courseDetail.filter((c: any) => !!c.deleted_at).length,
      alive_jgcc: courseDetail
        .filter((c: any) => !c.deleted_at)
        .filter((c: any) => (c.name as string).toLowerCase().includes("jacksonville golf"))
        .map((c: any) => ({
          id: c.id,
          tee_count: c.tee_count,
          hole_count: c.hole_count,
          round_count: c.round_count
        }))
    },
    courses: courseDetail,
    players_summary: {
      total_alive: (players ?? []).length,
      guests: (players ?? []).filter((p: any) => p.is_guest).length,
      linked: (players ?? []).filter((p: any) => p.profile_id != null).length
    },
    link_candidates: linkCandidates,
    named_report: namedReport
  });
}
