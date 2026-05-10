import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Aggregate-counts only — no PII (no IDs, names, emails, group_ids).
 * Used during the 2026-05-10 production incident to confirm whether
 * data was deleted vs. hidden, without requiring the caller to be
 * authenticated. Safe to expose temporarily.
 *
 * After the incident is resolved, this route is removed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseAdmin();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    profiles,
    groups,
    members,
    players,
    playersAlive,
    courses,
    coursesAlive,
    coursesArchived,
    coursesTemplate,
    courseTees,
    courseHoles,
    rounds,
    roundsAlive,
    roundsArchived,
    rounds24h,
    scores,
    settlements,
    platformAdmins,
    signups24h
  ] = await Promise.all([
    sb.from("profiles").select("*", { head: true, count: "exact" }),
    sb.from("groups").select("*", { head: true, count: "exact" }),
    sb.from("group_members").select("*", { head: true, count: "exact" }),
    sb.from("players").select("*", { head: true, count: "exact" }),
    sb.from("players").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("courses").select("*", { head: true, count: "exact" }),
    sb.from("courses").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("courses").select("*", { head: true, count: "exact" }).not("deleted_at", "is", null),
    sb.from("courses").select("*", { head: true, count: "exact" }).eq("is_template", true),
    sb.from("course_tees").select("*", { head: true, count: "exact" }),
    sb.from("course_holes").select("*", { head: true, count: "exact" }),
    sb.from("rounds").select("*", { head: true, count: "exact" }),
    sb.from("rounds").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("rounds").select("*", { head: true, count: "exact" }).not("deleted_at", "is", null),
    sb.from("rounds").select("*", { head: true, count: "exact" }).gte("created_at", since24h),
    sb.from("scores").select("*", { head: true, count: "exact" }),
    sb.from("settlements").select("*", { head: true, count: "exact" }),
    sb.from("platform_admins").select("*", { head: true, count: "exact" }),
    sb.from("profiles").select("*", { head: true, count: "exact" }).gte("created_at", since24h)
  ]);

  return NextResponse.json({
    note: "Aggregate counts only — no PII. Temporary endpoint, removed post-incident.",
    counts: {
      profiles: profiles.count ?? 0,
      groups: groups.count ?? 0,
      group_members: members.count ?? 0,
      players_total: players.count ?? 0,
      players_alive: playersAlive.count ?? 0,
      players_archived: (players.count ?? 0) - (playersAlive.count ?? 0),
      courses_total: courses.count ?? 0,
      courses_alive: coursesAlive.count ?? 0,
      courses_archived: coursesArchived.count ?? 0,
      courses_template: coursesTemplate.count ?? 0,
      course_tees: courseTees.count ?? 0,
      course_holes: courseHoles.count ?? 0,
      rounds_total: rounds.count ?? 0,
      rounds_alive: roundsAlive.count ?? 0,
      rounds_archived: roundsArchived.count ?? 0,
      rounds_created_24h: rounds24h.count ?? 0,
      scores: scores.count ?? 0,
      settlements: settlements.count ?? 0,
      platform_admins: platformAdmins.count ?? 0,
      signups_24h: signups24h.count ?? 0
    }
  });
}
