import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage() {
  const sb = supabaseAdmin();
  const [{ data: courses }, { data: tees }, { data: rounds }, { data: groups }] = await Promise.all([
    sb.from("courses").select("id, name, city, state, group_id, created_at, deleted_at").order("name"),
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

  return (
    <div className="space-y-4">
      <header>
        <p className="h-eyebrow text-gold-400">Courses</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">
          {(courses?.length ?? 0).toLocaleString()} courses
        </h1>
      </header>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">City/State</th>
                <th className="px-3 py-2 text-left">Group</th>
                <th className="px-3 py-2 text-right">Tees</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(courses ?? []).map((c: any) => (
                <tr
                  key={c.id}
                  className={`border-t border-cream-100/8 hover:bg-brand-900/30 ${c.deleted_at ? "opacity-50" : ""}`}
                >
                  <td className="px-3 py-2 text-cream-50 font-medium">
                    {c.name}
                    {c.deleted_at && <span className="ml-2 text-xs text-red-300">deleted</span>}
                  </td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs">
                    {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs">
                    {groupName.get(c.group_id) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{teeCount.get(c.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{roundCount.get(c.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/courses/${c.id}`} className="text-xs text-gold-400 underline">
                      Edit →
                    </Link>
                  </td>
                </tr>
              ))}
              {(courses?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-cream-100/55 text-sm">
                    No courses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
