import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JgccQuickAdd } from "./jgcc-quick-add";
import { TemplateCard } from "./template-card";
import {
  partitionGroupCourses,
  filterTemplates,
  hasJgccInGroup as hasJgccInGroupFn,
  type TemplateCardData
} from "@/lib/courses-page";

/**
 * Courses page layout — three clearly-labeled sections so a course never
 * appears in more than one place at the same time:
 *
 *   YOUR COURSES   — alive group courses (the only section visible by default)
 *   COURSE LIBRARY — cross-group templates, filtered to exclude any
 *                    name-collision with your active courses
 *   ARCHIVED       — only visible when ?archived=1
 *
 * The Quick-Add tile shows ONLY when the group has zero JGCC copies.
 * If a JGCC copy exists, it appears once in YOUR COURSES — never twice.
 */
export default async function CoursesPage({
  searchParams
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  const sb = await supabaseServer();
  const { data: groups } = await sb.from("groups").select("id, name").limit(1);
  const groupId = groups?.[0]?.id;

  // Group courses — pull alive + archived in one query so we can show counts
  // and the archived section without a second round-trip.
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, city, state, course_tees(id), deleted_at")
    .eq("group_id", groupId ?? "")
    .order("name");

  const { alive: aliveGroupCourses, archived: archivedGroupCourses } =
    partitionGroupCourses((courses ?? []) as any);

  // Pull cross-group templates. Defensive on missing is_template column.
  // Filtering rules live in `filterTemplates` (lib/courses-page.ts) so the
  // "no course shows up in two sections" invariant has regression tests.
  let templates: TemplateCardData[] = [];
  try {
    const { data, error } = await sb
      .from("courses")
      .select("id, name, city, state, verification_status, course_tees(id)")
      .eq("is_template", true)
      .is("deleted_at", null)
      .order("name");
    if (!error && data) {
      templates = filterTemplates(data as any, (courses ?? []) as any);
    } else if (error) {
      // Fallback for envs that haven't applied 0026 yet — re-query
      // without verification_status. Lets the page render rather than
      // 500-ing during the rolling migration.
      const fallback = await sb
        .from("courses")
        .select("id, name, city, state, course_tees(id)")
        .eq("is_template", true)
        .is("deleted_at", null)
        .order("name");
      if (!fallback.error && fallback.data) {
        templates = filterTemplates(fallback.data as any, (courses ?? []) as any);
      }
    }
  } catch {
    /* migration not yet applied — show no templates */
  }

  const hasJgccInGroup = hasJgccInGroupFn(aliveGroupCourses);

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="h-eyebrow">Layouts</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Courses</h1>
          <p className="text-xs text-cream-100/55 mt-1">
            {aliveGroupCourses.length} active
            {archivedGroupCourses.length > 0 && ` · ${archivedGroupCourses.length} archived`}
            {templates.length > 0 && ` · ${templates.length} template${templates.length === 1 ? "" : "s"} available`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={showArchived ? "/courses" : "/courses?archived=1"}
            className="btn-ghost text-xs"
          >
            {showArchived ? "← Active only" : "View archived"}
          </Link>
          <Link href="/courses/import" className="btn-primary">📷 Import scorecard</Link>
          <Link href="/courses/new" className="btn-ghost">Add manually</Link>
        </div>
      </header>

      {/* Quick-add: shows ONLY when no JGCC exists yet in this group.
          Once one does, the regular YOUR COURSES list shows it — no
          duplicate hero tile, no two cards for the same course. */}
      {!hasJgccInGroup && groupId && <JgccQuickAdd groupId={groupId} />}

      {/* Section 1: YOUR COURSES (group's alive courses) */}
      {aliveGroupCourses.length > 0 && (
        <section className="space-y-2">
          <p className="h-eyebrow text-gold-400">Your courses</p>
          <div className="space-y-2">
            {aliveGroupCourses.map((c: any) => (
              <Link
                key={c.id}
                href={`/courses/${c.id}`}
                prefetch={false}
                className="card card-hover p-4 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-cream-50 truncate">{c.name}</div>
                  <div className="text-sm text-cream-100/55 truncate">
                    {[c.city, c.state].filter(Boolean).join(", ")}
                  </div>
                </div>
                <span className="text-sm text-cream-100/55 shrink-0">
                  {c.course_tees?.length ?? 0} tee
                  {(c.course_tees?.length ?? 0) === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state — shown only when there's truly nothing to show. */}
      {aliveGroupCourses.length === 0 && !hasJgccInGroup && (
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

      {/* Section 2: COURSE LIBRARY (cross-group templates only).
          Already filtered above to exclude any course present in your
          group, by id AND by name. */}
      {templates.length > 0 && (
        <section className="space-y-2">
          <p className="h-eyebrow text-gold-400">Course library</p>
          <p className="text-xs text-cream-100/55">
            Community templates from other groups. Clone one to add a fresh,
            editable copy to your group.
          </p>
          <div className="space-y-2">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </section>
      )}

      {/* Section 3: ARCHIVED — only when ?archived=1 + something to show. */}
      {showArchived && archivedGroupCourses.length > 0 && (
        <section className="space-y-2 mt-6">
          <p className="h-eyebrow text-cream-100/45">Archived</p>
          <p className="text-xs text-cream-100/45">
            Hidden from the main list. Round history is preserved. Restore from the
            course detail page.
          </p>
          <div className="space-y-2">
            {archivedGroupCourses.map((c: any) => (
              <Link
                key={c.id}
                href={`/courses/${c.id}`}
                prefetch={false}
                className="card card-hover p-4 flex items-center justify-between opacity-60"
              >
                <div className="min-w-0">
                  <div className="font-medium text-cream-50 truncate">{c.name}</div>
                  <div className="text-xs text-cream-100/45">archived</div>
                </div>
                <span className="text-sm text-cream-100/55 shrink-0">
                  {c.course_tees?.length ?? 0} tees
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
