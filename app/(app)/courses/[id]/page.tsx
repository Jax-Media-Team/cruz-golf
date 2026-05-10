import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CourseDetail } from "./course-detail";
import { CourseArchiveButton } from "./archive-button";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/courses/${id}`);

  const { data: course } = await sb
    .from("courses")
    .select("id, name, city, state, group_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!course) {
    // Course not found OR archived behind RLS — show a friendly empty
    // state instead of redirecting silently. Redirecting was hard to
    // distinguish from a 404 in the browser.
    return (
      <div className="space-y-5 max-w-3xl">
        <header>
          <p className="h-eyebrow text-red-300">Course not found</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            That course is gone or you don&apos;t have access
          </h1>
          <p className="text-sm text-cream-100/55 mt-1">
            It may have been archived or deleted. Open <Link href="/courses?archived=1" className="text-gold-400 underline">archived courses</Link> to look for it.
          </p>
        </header>
        <Link href="/courses" className="btn-secondary">← All courses</Link>
      </div>
    );
  }

  // Commissioner check for the archive button.
  const { data: gm } = await sb
    .from("group_members")
    .select("role")
    .eq("group_id", course.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const canArchive = gm?.role === "commissioner";

  const { data: tees } = await sb
    .from("course_tees")
    .select("id, name, gender, rating, slope, par, holes, course_holes(hole_number, par, stroke_index, yardage)")
    .eq("course_id", id)
    .order("rating", { ascending: false });

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow">Course{course.deleted_at ? " · archived" : ""}</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{course.name}</h1>
          <p className="text-sm text-cream-100/55 mt-0.5">
            {[course.city, course.state].filter(Boolean).join(", ") || "Location not set"}
          </p>
        </div>
        <Link href="/courses" className="btn-ghost text-sm">← All courses</Link>
      </header>
      <CourseDetail courseId={course.id} tees={(tees as any) ?? []} />
      {canArchive && (
        <div className="card p-4 flex items-center justify-between gap-3 border border-cream-100/10">
          <div>
            <p className="h-eyebrow text-cream-100/55">Manage</p>
            <p className="text-xs text-cream-100/55 mt-1">
              Archived courses disappear from /courses but stay queryable for
              round history and stats.
            </p>
          </div>
          <CourseArchiveButton courseId={course.id} isArchived={!!course.deleted_at} />
        </div>
      )}
    </div>
  );
}
