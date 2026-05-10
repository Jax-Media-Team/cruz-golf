import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Incident-only: list every course row for Patrick's group + every JGCC
 * copy in the system + run a write test (insert + immediate delete) to
 * prove RLS is no longer blocking course writes after 0022.
 *
 * Allowlisted to Patrick's two known emails.
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

  // Look up Patrick's group via auth.users -> group_members.
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => (x.email ?? "").toLowerCase() === emailRaw);
  if (!u) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const { data: members } = await sb
    .from("group_members")
    .select("group_id, role, groups(name)")
    .eq("profile_id", u.id);

  const groupId = (members ?? [])[0]?.group_id ?? null;
  const groupName = (members ?? [])[0] ? ((members ?? [])[0] as any).groups?.name : null;

  // All courses for Patrick's group.
  const { data: groupCourses } = groupId
    ? await sb
        .from("courses")
        .select("id, name, city, state, group_id, is_template, deleted_at, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
    : { data: [] };

  // Every JGCC copy (any group).
  const { data: jgccCopies } = await sb
    .from("courses")
    .select("id, name, group_id, is_template, deleted_at, created_at")
    .ilike("name", "%jacksonville golf%")
    .order("created_at", { ascending: true });

  // For Patrick's group's courses, count tees + holes.
  const courseDetail = await Promise.all(
    (groupCourses ?? []).map(async (c: any) => {
      const [{ count: teeCount }, { data: tees }] = await Promise.all([
        sb.from("course_tees").select("*", { head: true, count: "exact" }).eq("course_id", c.id),
        sb.from("course_tees").select("id, name, gender, rating, slope, par").eq("course_id", c.id)
      ]);
      const teeIds = (tees ?? []).map((t: any) => t.id);
      const safeTeeIds = teeIds.length > 0 ? teeIds : ["00000000-0000-0000-0000-000000000000"];
      const { count: holeCount } = await sb
        .from("course_holes")
        .select("*", { head: true, count: "exact" })
        .in("tee_id", safeTeeIds);
      return {
        id: c.id,
        name: c.name,
        city: c.city,
        state: c.state,
        is_template: c.is_template,
        deleted_at: c.deleted_at,
        created_at: c.created_at,
        tee_count: teeCount ?? 0,
        hole_count: holeCount ?? 0,
        tees: tees ?? []
      };
    })
  );

  // Write test: insert a fake course into Patrick's group, then delete it.
  // Service-role bypasses RLS so this confirms schema-level constraints
  // are happy (NOT NULL, defaults, etc.) but doesn't prove RLS is fixed.
  // RLS-fix proof comes separately by Patrick using the UI.
  let writeTest: any = null;
  if (groupId) {
    const testName = `__incident_smoke_test_${Date.now()}__`;
    const { data: created, error: createErr } = await sb
      .from("courses")
      .insert({ group_id: groupId, name: testName })
      .select("id, name")
      .single();
    if (createErr) {
      writeTest = { ok: false, error: createErr.message, code: createErr.code };
    } else {
      const { error: deleteErr } = await sb.from("courses").delete().eq("id", created!.id);
      writeTest = {
        ok: true,
        inserted: created,
        deleted: !deleteErr,
        delete_error: deleteErr?.message ?? null
      };
    }
  }

  return NextResponse.json({
    email: emailRaw,
    auth_user_id: u.id,
    group_id: groupId,
    group_name: groupName,
    group_courses: courseDetail,
    every_jgcc_copy: jgccCopies,
    write_test: writeTest
  });
}
