import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JgccQuickAdd } from "./jgcc-quick-add";
import { TemplateCard } from "./template-card";

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

  // Group courses (alive by default; show archived too when ?archived=1).
  let q = sb
    .from("courses")
    .select("id, name, city, state, course_tees(id), deleted_at")
    .eq("group_id", groupId ?? "")
    .order("name");
  if (!showArchived) q = q.is("deleted_at", null);
  const { data: courses } = await q;

  // Pull template courses for the cross-group library. Defensive on missing
  // is_template column (pre-0020 envs).
  let templates: Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    tee_count: number;
  }> = [];
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

  const aliveGroupCourses = (courses ?? []).filter((c: any) => !c.deleted_at);
  const archivedGroupCourses = (courses ?? []).filter((c: any) => !!c.deleted_at);

  // Find Patrick's existing JGCC course (if any) so the Quick Add card can
  // turn into an "Open JGCC" button instead of creating a duplicate.
  const existingJgcc = aliveGroupCourses.find((c: any) =>
    (c.name as string).toLowerCase().includes("jacksonville golf")
  );

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="h-eyebrow">Layouts</p>
          <h1 className="h-display text-4xl text-cream-50 mt-1">Courses</h1>
          <p className="text-xs text-cream-100/55 mt-1">
            {aliveGroupCourses.length} active
            {archivedGroupCourses.length > 0 && ` · ${archivedGroupCourses.length} archived`}
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

      {/* JGCC quick-add tile: shows ONE of three states.
          1. Course already in your group → "Open JGCC →"
          2. Template available + no copy yet → small Clone CTA
          3. No template, no copy → original Quick Add */}
      {existingJgcc ? (
        <Link
          href={`/courses/${existingJgcc.id}`}
          className="card card-hover p-5 flex items-center justify-between gap-3 hover:bg-brand-900/80 transition-colors"
        >
          <div className="flex items-center gap-4">
            <span className="text-3xl">🌴</span>
            <div>
              <div className="font-serif text-xl text-cream-50">
                Jacksonville Golf & Country Club
              </div>
              <p className="text-xs text-cream-100/65 mt-0.5">
                Already in your group&apos;s library — open to manage tees, pars, SI, yardages.
              </p>
            </div>
          </div>
          <span className="pill bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30 text-xs">
            Already added
          </span>
        </Link>
      ) : (
        groupId && <JgccQuickAdd groupId={groupId} />
      )}

      {/* Community library — templates anyone can clone. We hide a template
          if your group already has a course with the same name (no duplicates). */}
      {templates.length > 0 && (() => {
        const aliveNamesLower = new Set(
          aliveGroupCourses.map((c: any) => (c.name as string).toLowerCase())
        );
        const showableTemplates = templates.filter(
          (t) => !aliveNamesLower.has(t.name.toLowerCase())
        );
        if (showableTemplates.length === 0) return null;
        return (
          <section className="space-y-2">
            <p className="h-eyebrow text-gold-400">Course library</p>
            <p className="text-xs text-cream-100/55">
              Clone any of these into your group. You&apos;ll get a fresh copy
              you can edit independently.
            </p>
            <div className="space-y-2">
              {showableTemplates.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          </section>
        );
      })()}

      {aliveGroupCourses.length === 0 && !existingJgcc && (
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
              {c.course_tees?.length ?? 0} tee{(c.course_tees?.length ?? 0) === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
      </div>

      {/* Archived section */}
      {showArchived && archivedGroupCourses.length > 0 && (
        <section className="space-y-2 mt-6">
          <p className="h-eyebrow text-cream-100/45">Archived</p>
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
