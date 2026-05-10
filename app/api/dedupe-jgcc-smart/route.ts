import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Smarter JGCC dedupe than fn_dedupe_jgcc_in_group:
 *   canonical = the course with the most ROUNDS attached, then
 *   most course_holes, then oldest created_at.
 *
 * This matters because Patrick's 4 rounds of history reference the
 * original course id. If we picked by "most holes" alone, we'd lose
 * the link to history — all duplicates have the same hole count.
 *
 * After picking canonical:
 *   - Restore canonical (deleted_at = null) if it was archived
 *   - Archive every other JGCC in the group (deleted_at = now())
 *
 * Service-role; no auth check beyond the email allowlist. Removed
 * after the incident.
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
  const dryRun = url.searchParams.get("dry") === "1";

  const sb = supabaseAdmin();

  // Resolve user → group.
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => (x.email ?? "").toLowerCase() === emailRaw);
  if (!u) return NextResponse.json({ error: "user not found" }, { status: 404 });
  const { data: members } = await sb
    .from("group_members")
    .select("group_id")
    .eq("profile_id", u.id);
  const groupId = members?.[0]?.group_id;
  if (!groupId) return NextResponse.json({ error: "no group" }, { status: 404 });

  // Pull every JGCC course in this group, ALIVE OR ARCHIVED. The candidate
  // with rounds may be the archived one.
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, group_id, deleted_at, created_at")
    .eq("group_id", groupId)
    .ilike("name", "%jacksonville golf%")
    .order("created_at", { ascending: true });

  if (!courses || courses.length === 0) {
    return NextResponse.json({ ok: true, message: "no JGCC in this group" });
  }

  // Attach round_count + hole_count to each.
  const enriched = await Promise.all(
    courses.map(async (c: any) => {
      const [{ data: tees }, { count: roundCount }] = await Promise.all([
        sb.from("course_tees").select("id").eq("course_id", c.id),
        sb.from("rounds").select("*", { head: true, count: "exact" }).eq("course_id", c.id)
      ]);
      const teeIds = (tees ?? []).map((t: any) => t.id);
      const safeIds = teeIds.length > 0 ? teeIds : ["00000000-0000-0000-0000-000000000000"];
      const { count: holeCount } = await sb
        .from("course_holes")
        .select("*", { head: true, count: "exact" })
        .in("tee_id", safeIds);
      return {
        ...c,
        tee_count: teeIds.length,
        hole_count: holeCount ?? 0,
        round_count: roundCount ?? 0
      };
    })
  );

  // Canonical: most rounds, then most holes, then oldest.
  enriched.sort((a, b) => {
    if (b.round_count !== a.round_count) return b.round_count - a.round_count;
    if (b.hole_count !== a.hole_count) return b.hole_count - a.hole_count;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const canonical = enriched[0];
  const others = enriched.slice(1);

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      group_id: groupId,
      canonical: {
        id: canonical.id,
        currently_archived: !!canonical.deleted_at,
        round_count: canonical.round_count,
        hole_count: canonical.hole_count,
        created_at: canonical.created_at,
        plan: canonical.deleted_at ? "RESTORE" : "KEEP_ALIVE"
      },
      others: others.map((o) => ({
        id: o.id,
        currently_archived: !!o.deleted_at,
        round_count: o.round_count,
        hole_count: o.hole_count,
        created_at: o.created_at,
        plan: o.deleted_at ? "ALREADY_ARCHIVED_KEEP_ARCHIVED" : "ARCHIVE"
      })),
      total_courses: enriched.length
    });
  }

  // Apply: restore canonical if archived, archive everything else still alive.
  const operations: any[] = [];
  if (canonical.deleted_at) {
    const { error } = await sb
      .from("courses")
      .update({ deleted_at: null })
      .eq("id", canonical.id);
    operations.push({ op: "RESTORE", id: canonical.id, ok: !error, error: error?.message });
  } else {
    operations.push({ op: "ALREADY_ALIVE", id: canonical.id });
  }
  for (const o of others) {
    if (o.deleted_at) {
      operations.push({ op: "ALREADY_ARCHIVED_KEEP_ARCHIVED", id: o.id });
      continue;
    }
    const { error } = await sb
      .from("courses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", o.id);
    operations.push({ op: "ARCHIVE", id: o.id, ok: !error, error: error?.message });
  }

  return NextResponse.json({
    ok: true,
    group_id: groupId,
    canonical: {
      id: canonical.id,
      round_count: canonical.round_count,
      hole_count: canonical.hole_count
    },
    operations
  });
}
