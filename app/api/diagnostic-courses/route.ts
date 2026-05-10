import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Re-instated incident endpoint. Lists Patrick's group's courses with
 * their tee/hole counts. Allowlisted to known emails. Removed once we
 * stop hunting the duplicate-JGCC + desktop-link 404 issues.
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

  const { data: groupCourses } = groupId
    ? await sb
        .from("courses")
        .select("id, name, group_id, is_template, deleted_at, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
    : { data: [] };

  const detail = await Promise.all(
    (groupCourses ?? []).map(async (c: any) => {
      const { data: tees } = await sb
        .from("course_tees")
        .select("id")
        .eq("course_id", c.id);
      const teeIds = (tees ?? []).map((t: any) => t.id);
      const safeTeeIds = teeIds.length > 0 ? teeIds : ["00000000-0000-0000-0000-000000000000"];
      const { count: holeCount } = await sb
        .from("course_holes")
        .select("*", { head: true, count: "exact" })
        .in("tee_id", safeTeeIds);
      // Round usage: any rounds reference this course?
      const { count: roundCount } = await sb
        .from("rounds")
        .select("*", { head: true, count: "exact" })
        .eq("course_id", c.id);
      return {
        ...c,
        tee_count: teeIds.length,
        hole_count: holeCount ?? 0,
        round_count: roundCount ?? 0
      };
    })
  );

  return NextResponse.json({
    group_id: groupId,
    courses: detail
  });
}
