import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JgccQuickAdd } from "./jgcc-quick-add";

export default async function CoursesPage() {
  const sb = await supabaseServer();
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  const groupId = groups?.[0]?.id;
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, city, state, course_tees(id)")
    .eq("group_id", groupId ?? "")
    .is("deleted_at", null)
    .order("name");

  const hasJgcc = !!courses?.find((c: any) =>
    (c.name as string).toLowerCase().includes("jacksonville golf")
  );

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="h-eyebrow">Layouts</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Courses</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/courses/import" className="btn-primary">📷 Import scorecard</Link>
          <Link href="/courses/new" className="btn-ghost">Add manually</Link>
        </div>
      </header>

      {!hasJgcc && groupId && <JgccQuickAdd groupId={groupId} />}

      {(!courses || courses.length === 0) && (
        <div className="card p-8 text-center text-cream-100/70 space-y-2">
          <p>No courses yet.</p>
          <p className="text-xs text-cream-100/55">
            Snap a photo of any scorecard with{" "}
            <Link className="text-gold-400 underline" href="/courses/import">
              Import scorecard
            </Link>{" "}
            — or{" "}
            <Link className="text-cream-50 underline" href="/courses/new">
              build one manually
            </Link>
            .
          </p>
        </div>
      )}
      <div className="space-y-2">
        {courses?.map((c: any) => (
          <Link key={c.id} href={`/courses/${c.id}`} className="card card-hover p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-cream-50">{c.name}</div>
              <div className="text-sm text-cream-100/55">{[c.city, c.state].filter(Boolean).join(", ")}</div>
            </div>
            <span className="text-sm text-cream-100/55">{c.course_tees?.length ?? 0} tees</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
