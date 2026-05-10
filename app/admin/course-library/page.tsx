import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { LibrarySearch } from "./library-search";
import { BulkCourseTable, type CourseRow } from "./bulk-table";

export const dynamic = "force-dynamic";

/**
 * Admin moderation surface for the cross-group course library.
 *
 * Patrick (2026-05-10): "I'd rather not build fragile or non-compliant
 * scraping systems... build a seeded/community course library system
 * with verification states + admin moderation."
 *
 * This page is the moderation UI:
 *   - Templates grouped by verification status (placeholder / community /
 *     needs review / verified)
 *   - Per-row controls to promote / demote / flag for review / drop
 *     template flag
 *   - Quick depth indicators (tee count, hole count, rounds-using-this-
 *     template count) so an admin can tell at a glance whether the
 *     course has enough data to be promoted
 *
 * RPCs used (defined in 0026):
 *   - fn_set_course_verification(course_id, status)
 *   - fn_set_course_template(course_id, is_template)
 *
 * Both are gated server-side on fn_is_platform_admin() so a non-admin
 * stumbling onto this page can't mutate anything.
 */
export default async function AdminCourseLibraryPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim().toLowerCase();
  const sb = supabaseAdmin();

  const [{ data: courses }, { data: tees }, { data: holes }, { data: rounds }] =
    await Promise.all([
      sb
        .from("courses")
        .select(
          "id, name, city, state, group_id, is_template, verification_status, submitted_by, deleted_at, created_at"
        )
        .eq("is_template", true)
        .is("deleted_at", null)
        .order("name"),
      sb.from("course_tees").select("id, course_id"),
      sb.from("course_holes").select("tee_id"),
      sb.from("rounds").select("course_id")
    ]);

  // Per-course depth: how many tees + total holes + how many rounds
  // reference this course (across all groups). High-rounds counts mean
  // the data is in active use and must not be regressed.
  const teesByCourse = new Map<string, string[]>();
  for (const t of (tees as any[]) ?? []) {
    const arr = teesByCourse.get(t.course_id) ?? [];
    arr.push(t.id);
    teesByCourse.set(t.course_id, arr);
  }
  const holesByTee = new Map<string, number>();
  for (const h of (holes as any[]) ?? []) {
    holesByTee.set(h.tee_id, (holesByTee.get(h.tee_id) ?? 0) + 1);
  }
  const roundsByCourse = new Map<string, number>();
  for (const r of (rounds as any[]) ?? []) {
    if (!r.course_id) continue;
    roundsByCourse.set(r.course_id, (roundsByCourse.get(r.course_id) ?? 0) + 1);
  }

  const enriched: CourseRow[] = ((courses as any[]) ?? []).map((c) => {
    const teeIds = teesByCourse.get(c.id) ?? [];
    const holeCount = teeIds.reduce(
      (s, id) => s + (holesByTee.get(id) ?? 0),
      0
    );
    return {
      id: c.id,
      name: c.name,
      city: c.city,
      state: c.state,
      verification_status: c.verification_status ?? "community",
      is_template: !!c.is_template,
      tee_count: teeIds.length,
      hole_count: holeCount,
      round_count: roundsByCourse.get(c.id) ?? 0
    };
  });

  // Apply search filter (name + city + state, case-insensitive).
  const filtered = query
    ? enriched.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.city ?? "").toLowerCase().includes(query) ||
          (c.state ?? "").toLowerCase().includes(query)
      )
    : enriched;

  // Bucket by status for at-a-glance moderation.
  const buckets = {
    placeholder: filtered.filter((c) => c.verification_status === "placeholder"),
    community: filtered.filter((c) => c.verification_status === "community"),
    needs_review: filtered.filter((c) => c.verification_status === "needs_review"),
    verified: filtered.filter((c) => c.verification_status === "verified")
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Course library</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            Moderation
          </h1>
          <p className="text-sm text-cream-100/65 mt-1">
            Cross-group templates that show up in every user&apos;s course
            library. Promote / demote / flag below. Non-template courses
            owned by individual groups are not shown here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <SummaryPill label="Verified" count={buckets.verified.length} tone="gold" />
          <SummaryPill label="Needs review" count={buckets.needs_review.length} tone="amber" />
          <SummaryPill label="Community" count={buckets.community.length} tone="cream" />
          <SummaryPill label="Placeholder" count={buckets.placeholder.length} tone="muted" />
        </div>
      </header>

      <LibrarySearch initialQuery={query} />

      <BulkCourseTable label="Needs review" rows={buckets.needs_review} tone="amber" />
      <BulkCourseTable label="Awaiting scorecard data" rows={buckets.placeholder} tone="muted" />
      <BulkCourseTable label="Community" rows={buckets.community} tone="cream" />
      <BulkCourseTable label="Verified" rows={buckets.verified} tone="gold" />

      {enriched.length === 0 && (
        <div className="card p-8 text-center text-cream-100/65 text-sm">
          No template courses yet. Promote a course to a template via{" "}
          <Link href="/admin/courses" className="text-gold-400 underline">
            /admin/courses
          </Link>{" "}
          to populate the library.
        </div>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  count,
  tone
}: {
  label: string;
  count: number;
  tone: "gold" | "amber" | "cream" | "muted";
}) {
  const cls =
    tone === "gold"
      ? "bg-gold-500/15 text-gold-400 ring-gold-500/30"
      : tone === "amber"
      ? "bg-amber-500/15 text-amber-200 ring-amber-400/30"
      : tone === "cream"
      ? "bg-cream-100/10 text-cream-100/85 ring-cream-100/15"
      : "bg-cream-100/8 text-cream-100/55 ring-cream-100/15";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ${cls}`}
    >
      <span>{label}</span>
      <span className="tabular-nums font-medium">{count}</span>
    </span>
  );
}
