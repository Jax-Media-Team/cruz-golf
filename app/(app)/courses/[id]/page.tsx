import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CourseDetail } from "./course-detail";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/courses/${id}`);

  const { data: course } = await sb
    .from("courses")
    .select("id, name, city, state, group_id")
    .eq("id", id)
    .single();
  if (!course) redirect("/courses");

  const { data: tees } = await sb
    .from("course_tees")
    .select("id, name, gender, rating, slope, par, holes, course_holes(hole_number, par, stroke_index, yardage)")
    .eq("course_id", id)
    .order("rating", { ascending: false });

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="h-eyebrow">Course</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">{course.name}</h1>
          <p className="text-sm text-cream-100/55 mt-0.5">
            {[course.city, course.state].filter(Boolean).join(", ") || "Location not set"}
          </p>
        </div>
        <Link href="/courses" className="btn-ghost text-sm">← All courses</Link>
      </header>
      <CourseDetail courseId={course.id} tees={(tees as any) ?? []} />
    </div>
  );
}
