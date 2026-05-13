import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Admin courses overview.
 *
 * Patrick 2026-05-12: "Why does it say '30' courses in the admin console?
 * Almost all of them are JGCC and some deleted, every JGCC member has one."
 *
 * Every group bootstraps its own copy of JGCC (no shared course
 * template across groups), so as the userbase grows the raw `courses`
 * count goes up linearly. This page now:
 *
 *   1. **Hides archived clones by default.** `?archived=1` reveals them.
 *      Patrick was counting `deleted_at IS NOT NULL` rows toward the
 *      headline number, which is misleading.
 *   2. **Groups by course name** so JGCC × 25 groups renders as a
 *      single card with a "25 groups · 137 tees · 412 rounds" subline.
 *      The dedup is purely visual — the per-group rows are still
 *      reachable via "View groups →" expansion (anchor links into
 *      /admin/groups). Saves the moderation surface from being a
 *      sea of identical JGCC entries.
 *   3. **Course-library badge** on names that exist as `is_template=true`.
 *      Quick visual for which courses are master templates vs. just
 *      group clones.
 */
export default async function AdminCoursesPage({
  searchParams
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  const sb = supabaseAdmin();
  const [{ data: courses }, { data: tees }, { data: rounds }, { data: groups }] = await Promise.all([
    sb
      .from("courses")
      .select("id, name, city, state, group_id, created_at, deleted_at, is_template, verification_status")
      .order("name"),
    sb.from("course_tees").select("course_id, name, rating, slope"),
    sb.from("rounds").select("course_id"),
    sb.from("groups").select("id, name")
  ]);

  const teeCount = new Map<string, number>();
  for (const t of (tees ?? []) as any[]) {
    teeCount.set(t.course_id, (teeCount.get(t.course_id) ?? 0) + 1);
  }
  const roundCount = new Map<string, number>();
  for (const r of (rounds ?? []) as any[]) {
    roundCount.set(r.course_id, (roundCount.get(r.course_id) ?? 0) + 1);
  }
  const groupName = new Map((groups ?? []).map((g: any) => [g.id, g.name]));

  // Partition by archived flag first; the headline count + the
  // grouped-by-name view both run on the alive set.
  type Course = {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    group_id: string;
    created_at: string;
    deleted_at: string | null;
    is_template: boolean | null;
    verification_status: string | null;
  };
  const all = (courses ?? []) as Course[];
  const alive = all.filter((c) => !c.deleted_at);
  const archived = all.filter((c) => c.deleted_at);

  // Group alive courses by (lowercased, trimmed) name. The bucket
  // surfaces: number of clones, number of distinct groups (≈ users),
  // total tees, total rounds, whether a template exists in the bucket.
  type Bucket = {
    nameDisplay: string;
    clones: Course[];
    distinctGroups: Set<string>;
    totalTees: number;
    totalRounds: number;
    hasTemplate: boolean;
    verifiedAny: boolean;
  };
  const buckets = new Map<string, Bucket>();
  for (const c of alive) {
    const key = (c.name ?? "").trim().toLowerCase();
    const b = buckets.get(key) ?? {
      nameDisplay: c.name,
      clones: [],
      distinctGroups: new Set<string>(),
      totalTees: 0,
      totalRounds: 0,
      hasTemplate: false,
      verifiedAny: false
    };
    b.clones.push(c);
    if (c.group_id) b.distinctGroups.add(c.group_id);
    b.totalTees += teeCount.get(c.id) ?? 0;
    b.totalRounds += roundCount.get(c.id) ?? 0;
    if (c.is_template) b.hasTemplate = true;
    if (c.verification_status === "verified") b.verifiedAny = true;
    buckets.set(key, b);
  }
  // Order: most clones first, then most rounds, then name.
  const orderedBuckets = [...buckets.values()].sort((a, b) => {
    if (b.clones.length !== a.clones.length) return b.clones.length - a.clones.length;
    if (b.totalRounds !== a.totalRounds) return b.totalRounds - a.totalRounds;
    return a.nameDisplay.localeCompare(b.nameDisplay);
  });

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Courses</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {orderedBuckets.length.toLocaleString()} distinct
            <span className="text-cream-100/55 text-base font-normal ml-2">
              · {alive.length} clones across {new Set(alive.map((c) => c.group_id)).size} groups
            </span>
          </h1>
          {archived.length > 0 && (
            <p className="text-xs text-cream-100/55 mt-1">
              {archived.length} archived clone{archived.length === 1 ? "" : "s"} hidden
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={showArchived ? "/admin/courses" : "/admin/courses?archived=1"}
            className="btn-ghost text-xs"
          >
            {showArchived ? "← Active only" : `View archived (${archived.length})`}
          </Link>
          <Link href="/admin/course-library" className="btn-ghost text-xs">
            Course library →
          </Link>
        </div>
      </header>

      {/* Grouped-by-name view — collapses the 25× JGCC duplicates into
          a single row with a "25 groups" count. Drill into a single
          row via the chevron to see the individual per-group clones. */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-right">Groups</th>
                <th className="px-3 py-2 text-right">Tees</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orderedBuckets.map((b) => {
                // First clone in the bucket — what we'll link to as the
                // "primary" detail page when there's only one group.
                const primary = b.clones[0];
                return (
                  <tr
                    key={b.nameDisplay + "|" + primary.id}
                    className="border-t border-cream-100/8 hover:bg-brand-900/30"
                  >
                    <td className="px-3 py-2 text-cream-50 font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{b.nameDisplay}</span>
                        {b.hasTemplate && (
                          <span className="text-[10px] uppercase tracking-wide bg-gold-500/15 text-gold-400 px-1.5 py-0.5 rounded">
                            template
                          </span>
                        )}
                        {b.verifiedAny && (
                          <span className="text-[10px] uppercase tracking-wide text-emerald-300/85">
                            verified
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-cream-100/55">
                        {[primary.city, primary.state].filter(Boolean).join(", ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.distinctGroups.size}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.totalTees}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.totalRounds}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link
                        href={`/courses/${primary.id}`}
                        className="text-xs text-gold-400 underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {orderedBuckets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-cream-100/55 text-sm">
                    No courses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Archived clones — only when ?archived=1. Each row links to the
          group-scoped detail page so admins can restore from there. */}
      {showArchived && archived.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 bg-brand-950/50 text-[11px] uppercase tracking-wider text-cream-100/55">
            Archived clones
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-950/30 text-[10px] uppercase tracking-wider text-cream-100/55">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Group</th>
                  <th className="px-3 py-2 text-right">Tees</th>
                  <th className="px-3 py-2 text-right">Rounds</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {archived.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-cream-100/8 hover:bg-brand-900/30 opacity-60"
                  >
                    <td className="px-3 py-2 text-cream-50">
                      {c.name}
                      <span className="ml-2 text-xs text-red-300">archived</span>
                    </td>
                    <td className="px-3 py-2 text-cream-100/65 text-xs">
                      {groupName.get(c.group_id) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {teeCount.get(c.id) ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {roundCount.get(c.id) ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/courses/${c.id}`} className="text-xs text-gold-400 underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
