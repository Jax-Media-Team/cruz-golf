import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Per-user diagnostic. Looks up the requested email, returns:
 *   - whether a profile exists for them
 *   - every group_members row for that profile (group_id, role)
 *   - each of those groups' alive-row counts
 *
 * Hardcoded allowlist of emails: only Patrick's accounts. Anyone hitting
 * this with a different email gets 403. Used during the 2026-05-10
 * incident to confirm whether Patrick's `group_members` row was lost
 * (forcing the dashboard to show a brand-new empty group).
 *
 * Removed after the incident is resolved.
 */
export const dynamic = "force-dynamic";

const ALLOW = new Set([
  "pcruz@stetson.edu",
  "pcruz@jaxmediateam.com"
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const emailRaw = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!ALLOW.has(emailRaw)) {
    return NextResponse.json({ error: "email not in allowlist" }, { status: 403 });
  }
  const sb = supabaseAdmin();

  // 1. auth.users lookup
  const { data: authList, error: authErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (authErr) {
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }
  const authUser = authList.users.find((u) => (u.email ?? "").toLowerCase() === emailRaw);
  if (!authUser) {
    return NextResponse.json({
      email: emailRaw,
      auth_user: null,
      message: "no auth.users row for this email"
    });
  }

  const userId = authUser.id;

  // 2. profile
  const { data: profile } = await sb
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("id", userId)
    .maybeSingle();

  // 3. group_members
  const { data: members } = await sb
    .from("group_members")
    .select("group_id, role, groups(name, created_at)")
    .eq("profile_id", userId);

  // 4. for each group, count alive courses/players/rounds
  const groupStats = await Promise.all(
    (members ?? []).map(async (m: any) => {
      const [coursesAlive, playersAlive, roundsAlive] = await Promise.all([
        sb.from("courses").select("*", { head: true, count: "exact" }).eq("group_id", m.group_id).is("deleted_at", null),
        sb.from("players").select("*", { head: true, count: "exact" }).eq("group_id", m.group_id).is("deleted_at", null),
        sb.from("rounds").select("*", { head: true, count: "exact" }).eq("group_id", m.group_id).is("deleted_at", null)
      ]);
      return {
        group_id: m.group_id,
        group_name: m.groups?.name ?? "(unknown)",
        group_created_at: m.groups?.created_at ?? null,
        role: m.role,
        courses_alive: coursesAlive.count ?? 0,
        players_alive: playersAlive.count ?? 0,
        rounds_alive: roundsAlive.count ?? 0
      };
    })
  );

  // 5. groups OWNED (created_by) by this user that they may NOT be a
  //    member of (the failure mode we're hunting).
  const { data: ownedGroups } = await sb
    .from("groups")
    .select("id, name, created_at, created_by")
    .eq("created_by", userId);

  const memberGroupIds = new Set((members ?? []).map((m: any) => m.group_id));
  const ownedNotMember = (ownedGroups ?? []).filter((g) => !memberGroupIds.has(g.id));

  // 6. is platform admin?
  const { data: adminRow } = await sb
    .from("platform_admins")
    .select("granted_at")
    .eq("profile_id", userId)
    .maybeSingle();

  return NextResponse.json({
    email: emailRaw,
    auth_user_id: userId,
    auth_created_at: authUser.created_at,
    last_sign_in_at: authUser.last_sign_in_at,
    profile,
    is_platform_admin: !!adminRow,
    member_of_groups: groupStats,
    owned_but_not_member_of: ownedNotMember.map((g) => ({
      group_id: g.id,
      group_name: g.name,
      created_at: g.created_at
    }))
  });
}
