import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Platform overview. High-level counts + recent activity.
 *
 * Uses the service-role client because we need to count across every
 * group/user. The /admin layout guards the route via fn_is_platform_admin().
 */
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const sb = supabaseAdmin();

  const [
    profiles,
    groups,
    rounds,
    courses,
    players,
    scoreCount,
    uploads,
    recentUsers,
    recentRounds
  ] = await Promise.all([
    sb.from("profiles").select("*", { head: true, count: "exact" }),
    sb.from("groups").select("*", { head: true, count: "exact" }),
    sb.from("rounds").select("*", { head: true, count: "exact" }),
    sb.from("courses").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("players").select("*", { head: true, count: "exact" }).is("deleted_at", null),
    sb.from("scores").select("*", { head: true, count: "exact" }),
    sb.from("scorecard_uploads").select("*", { head: true, count: "exact" }),
    sb
      .from("profiles")
      .select("id, display_name, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("rounds")
      .select("id, date, status, created_at, group_id, courses(name), groups(name)")
      .order("created_at", { ascending: false })
      .limit(10)
  ]);

  const liveRounds = await sb
    .from("rounds")
    .select("*", { head: true, count: "exact" })
    .eq("status", "live");
  const finalizedRounds = await sb
    .from("rounds")
    .select("*", { head: true, count: "exact" })
    .eq("status", "finalized");

  return (
    <div className="space-y-6">
      <header>
        <p className="h-eyebrow text-gold-400">Platform</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Overview</h1>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Users" value={profiles.count ?? 0} href="/admin/users" />
        <Stat label="Groups" value={groups.count ?? 0} href="/admin/groups" />
        <Stat label="Rounds" value={rounds.count ?? 0} href="/admin/rounds" />
        <Stat label="Courses" value={courses.count ?? 0} href="/admin/courses" />
        <Stat label="Players (in groups)" value={players.count ?? 0} />
        <Stat label="Live rounds" value={liveRounds.count ?? 0} accent />
        <Stat label="Finalized rounds" value={finalizedRounds.count ?? 0} />
        <Stat label="Scores entered" value={scoreCount.count ?? 0} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">Recent signups</h2>
            <Link href="/admin/users" className="text-xs text-gold-400 underline">View all →</Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {recentUsers.data?.map((u: any) => (
              <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50 truncate">{u.display_name || "(no name)"}</span>
                <span className="text-xs text-cream-100/45 tabular-nums shrink-0">
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
            {(recentUsers.data?.length ?? 0) === 0 && (
              <li className="py-2 text-cream-100/55 text-xs">No users yet.</li>
            )}
          </ul>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-cream-50">Recent rounds</h2>
            <Link href="/admin/rounds" className="text-xs text-gold-400 underline">View all →</Link>
          </div>
          <ul className="divide-y divide-cream-100/8 text-sm">
            {recentRounds.data?.map((r: any) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-cream-50 truncate">
                  {r.courses?.name ?? "Course"} <span className="text-cream-100/45">·</span>{" "}
                  <span className="text-cream-100/55 text-xs">{r.groups?.name ?? "Group"}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span
                    className={
                      r.status === "live"
                        ? "pill-live text-xs"
                        : r.status === "finalized"
                        ? "pill-final text-xs"
                        : "pill-draft text-xs"
                    }
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-cream-100/45 tabular-nums">{r.date}</span>
                </span>
              </li>
            ))}
            {(recentRounds.data?.length ?? 0) === 0 && (
              <li className="py-2 text-cream-100/55 text-xs">No rounds yet.</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href, accent }: { label: string; value: number; href?: string; accent?: boolean }) {
  const inner = (
    <div
      className={`card p-4 ${href ? "card-hover" : ""} ${accent ? "border border-emerald-400/30" : ""}`}
    >
      <div className="text-xs text-cream-100/55 uppercase tracking-wider">{label}</div>
      <div
        className={`font-serif tabular-nums mt-1 ${accent ? "text-emerald-300" : "text-cream-50"}`}
        style={{ fontSize: 32, lineHeight: 1 }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
