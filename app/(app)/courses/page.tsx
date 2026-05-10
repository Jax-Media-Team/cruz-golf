import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JgccQuickAdd } from "./jgcc-quick-add";
import { TemplateCard } from "./template-card";

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

  // Pull template courses (community library). Defensive: the is_template
  // column lands in migration 0020; if the migration hasn't been applied
  // to this env yet we silently ignore the column-missing error.
  let templates: Array<{ id: string; name: string; city: string | null; state: string | null; tee_count: number }> = [];
  try {
    const { data, error } = await sb
      .from("courses")
      .select("id, name, city, state, course_tees(id)")
      .eq("is_template", true)
      .is("deleted_at", null)
      .order("name");
    if (!error && data) {
      templates = data.map((t: any) => ({
        id: t.id,
        name: t.name,
        city: t.city,
        state: t.state,
        tee_count: (t.course_tees ?? []).length
      }));
    }
  } catch {
    /* migration not yet applied — show no templates */
  }

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

      {/* Community library — templates anyone in the platform can clone.
          Cloned courses become normal courses inside your group, fully
          editable from there. Hidden when no templates exist. */}
      {templates.length > 0 && (
        <section className="space-y-2">
          <p className="h-eyebrow text-gold-400">Course library</p>
          <p className="text-xs text-cream-100/55">
            Clone any of these into your group. You&apos;ll get a fresh copy
            you can edit independently.
          </p>
          <div className="space-y-2">
            {templates
              // Hide templates whose name already exists in this group's library
              .filter(
                (t) =>
                  !courses?.some(
                    (c: any) =>
                      (c.name as string).toLowerCase() ===
                      t.name.toLowerCase()
                  )
              )
              .map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
          </div>
        </section>
      )}

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
