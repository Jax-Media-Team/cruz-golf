import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Incident-response diagnostic page. Bypasses RLS via the service-role
 * client and reports raw row counts + per-group breakdown so we can see
 * exactly what data exists vs. what the user is missing.
 *
 * Read-only. Platform-admin gated by /admin/layout.tsx.
 */
export const dynamic = "force-dynamic";

export default async function AdminDiagnosticPage() {
  const sb = supabaseAdmin();

  // Pull everything in parallel with explicit `count: "exact"` so we see
  // raw row counts even when RLS would normally hide rows. This is the
  // ground truth.
  const [
    profiles,
    groups,
    members,
    players,
    courses,
    courseTees,
    courseHoles,
    rounds,
    roundPlayers,
    scores,
    settlements,
    platformAdmins,
    feedback
  ] = await Promise.all([
    sb.from("profiles").select("*", { head: true, count: "exact" }),
    sb.from("groups").select("*", { head: true, count: "exact" }),
    sb.from("group_members").select("*", { head: true, count: "exact" }),
    sb.from("players").select("*", { head: true, count: "exact" }),
    sb.from("courses").select("*", { head: true, count: "exact" }),
    sb.from("course_tees").select("*", { head: true, count: "exact" }),
    sb.from("course_holes").select("*", { head: true, count: "exact" }),
    sb.from("rounds").select("*", { head: true, count: "exact" }),
    sb.from("round_players").select("*", { head: true, count: "exact" }),
    sb.from("scores").select("*", { head: true, count: "exact" }),
    sb.from("settlements").select("*", { head: true, count: "exact" }),
    sb.from("platform_admins").select("*", { head: true, count: "exact" }),
    sb.from("feedback").select("*", { head: true, count: "exact" })
  ]);

  // Per-group breakdown — courses + players + rounds counts per group,
  // including archived (deleted_at) so we can spot soft-deletes.
  const { data: groupRows } = await sb
    .from("groups")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  const groupBreakdown: Array<{
    id: string;
    name: string;
    created_at: string;
    member_count: number;
    player_alive: number;
    player_archived: number;
    course_alive: number;
    course_archived: number;
    rounds_alive: number;
    rounds_archived: number;
  }> = [];

  for (const g of (groupRows ?? []) as any[]) {
    const [m, pAlive, pArch, cAlive, cArch, rAlive, rArch] = await Promise.all([
      sb.from("group_members").select("*", { head: true, count: "exact" }).eq("group_id", g.id),
      sb.from("players").select("*", { head: true, count: "exact" }).eq("group_id", g.id).is("deleted_at", null),
      sb.from("players").select("*", { head: true, count: "exact" }).eq("group_id", g.id).not("deleted_at", "is", null),
      sb.from("courses").select("*", { head: true, count: "exact" }).eq("group_id", g.id).is("deleted_at", null),
      sb.from("courses").select("*", { head: true, count: "exact" }).eq("group_id", g.id).not("deleted_at", "is", null),
      sb.from("rounds").select("*", { head: true, count: "exact" }).eq("group_id", g.id).is("deleted_at", null),
      sb.from("rounds").select("*", { head: true, count: "exact" }).eq("group_id", g.id).not("deleted_at", "is", null)
    ]);
    groupBreakdown.push({
      id: g.id,
      name: g.name,
      created_at: g.created_at,
      member_count: m.count ?? 0,
      player_alive: pAlive.count ?? 0,
      player_archived: pArch.count ?? 0,
      course_alive: cAlive.count ?? 0,
      course_archived: cArch.count ?? 0,
      rounds_alive: rAlive.count ?? 0,
      rounds_archived: rArch.count ?? 0
    });
  }

  // Recent signups in the last 24 hours.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentAuth } = await sb
    .from("profiles")
    .select("id, display_name, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  // Per-user group membership for everyone who's signed up.
  const { data: members2 } = await sb
    .from("group_members")
    .select("profile_id, group_id, role, groups(name), profiles(display_name)")
    .order("group_id");

  // Recent rounds (any status) — last 20 across all groups.
  const { data: recentRounds } = await sb
    .from("rounds")
    .select("id, group_id, date, status, deleted_at, created_at, courses(name)")
    .order("created_at", { ascending: false })
    .limit(20);

  // Sanity check: list every JGCC course copy with its is_template flag.
  const { data: jgccCopies } = await sb
    .from("courses")
    .select("id, name, group_id, is_template, deleted_at, created_at")
    .ilike("name", "%jacksonville golf%")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-5">
      <header>
        <p className="h-eyebrow text-red-300">Incident triage</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Production diagnostic</h1>
        <p className="text-xs text-cream-100/55 mt-1">
          Read-only. Service-role client bypasses RLS so you see ground-truth
          row counts. Generated on every page load.
        </p>
      </header>

      {/* Top-line counts */}
      <section className="card p-5">
        <p className="h-eyebrow text-gold-400">Top-line counts (RAW)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          {[
            ["Profiles", profiles.count ?? 0],
            ["Groups", groups.count ?? 0],
            ["Group members", members.count ?? 0],
            ["Players (all)", players.count ?? 0],
            ["Courses (all)", courses.count ?? 0],
            ["Course tees", courseTees.count ?? 0],
            ["Course holes", courseHoles.count ?? 0],
            ["Rounds (all)", rounds.count ?? 0],
            ["Round players", roundPlayers.count ?? 0],
            ["Scores", scores.count ?? 0],
            ["Settlements", settlements.count ?? 0],
            ["Platform admins", platformAdmins.count ?? 0],
            ["Feedback rows", feedback.count ?? 0]
          ].map(([label, val]) => (
            <div key={label as string}>
              <div className="text-[10px] uppercase tracking-wider text-cream-100/55">
                {label}
              </div>
              <div className="font-serif text-2xl text-cream-50 tabular-nums">
                {(val as number).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* JGCC copies */}
      <section className="card p-5">
        <p className="h-eyebrow text-gold-400">JGCC course copies</p>
        <p className="text-xs text-cream-100/55 mt-1">
          One per group that&apos;s used the quick-add or cloned the template.
        </p>
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-cream-100/55">
              <th className="py-1">Course id</th>
              <th>Group</th>
              <th>Template?</th>
              <th>Archived?</th>
              <th className="text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {(jgccCopies ?? []).length === 0 && (
              <tr><td colSpan={5} className="py-3 text-cream-100/55 text-center">No JGCC copies found.</td></tr>
            )}
            {(jgccCopies ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-cream-100/8">
                <td className="py-1 font-mono text-[10px] text-cream-100/55">{c.id.slice(0, 8)}…</td>
                <td className="font-mono text-[10px] text-cream-100/55">{c.group_id?.slice(0, 8)}…</td>
                <td>{c.is_template ? "✓ template" : "—"}</td>
                <td>{c.deleted_at ? "🗑 yes" : "—"}</td>
                <td className="text-right text-[10px] text-cream-100/55">{new Date(c.created_at).toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Per-group breakdown */}
      <section className="card p-5">
        <p className="h-eyebrow text-gold-400">Per-group breakdown</p>
        <p className="text-xs text-cream-100/55 mt-1">
          Each group&apos;s data, with archived counts called out separately.
          Look here for &ldquo;data hidden because user is in a different group&rdquo;.
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-cream-100/55">
                <th className="py-1">Group</th>
                <th className="text-right">Members</th>
                <th className="text-right">Players</th>
                <th className="text-right">Courses</th>
                <th className="text-right">Rounds</th>
                <th className="text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {groupBreakdown.map((g) => (
                <tr key={g.id} className="border-t border-cream-100/8">
                  <td className="py-1 truncate max-w-[180px]">
                    <div className="text-cream-50">{g.name}</div>
                    <div className="font-mono text-[9px] text-cream-100/45">{g.id.slice(0, 8)}…</div>
                  </td>
                  <td className="text-right tabular-nums">{g.member_count}</td>
                  <td className="text-right tabular-nums">
                    {g.player_alive}
                    {g.player_archived > 0 && (
                      <span className="text-amber-300 text-[10px]"> +{g.player_archived} arch</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {g.course_alive}
                    {g.course_archived > 0 && (
                      <span className="text-amber-300 text-[10px]"> +{g.course_archived} arch</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {g.rounds_alive}
                    {g.rounds_archived > 0 && (
                      <span className="text-amber-300 text-[10px]"> +{g.rounds_archived} arch</span>
                    )}
                  </td>
                  <td className="text-right text-[10px] text-cream-100/55">
                    {g.created_at?.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent signups */}
      <section className="card p-5">
        <p className="h-eyebrow text-gold-400">Signups in the last 24 hours</p>
        <ul className="mt-3 text-sm divide-y divide-cream-100/8">
          {(recentAuth ?? []).length === 0 && (
            <li className="py-3 text-cream-100/55">None.</li>
          )}
          {(recentAuth ?? []).map((u: any) => (
            <li key={u.id} className="py-1.5 flex justify-between">
              <span className="text-cream-50">{u.display_name || "(no name)"}</span>
              <span className="font-mono text-[10px] text-cream-100/55">{u.id.slice(0, 8)}… · {u.created_at?.slice(0, 19)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent rounds */}
      <section className="card p-5">
        <p className="h-eyebrow text-gold-400">Last 20 rounds (any status)</p>
        <ul className="mt-3 text-sm divide-y divide-cream-100/8">
          {(recentRounds ?? []).length === 0 && (
            <li className="py-3 text-cream-100/55">None.</li>
          )}
          {(recentRounds ?? []).map((r: any) => (
            <li key={r.id} className="py-1.5 flex justify-between gap-3">
              <span className="text-cream-50 truncate">{r.courses?.name ?? "(no course)"}</span>
              <span className="text-[10px] text-cream-100/55 tabular-nums shrink-0">
                {r.status}
                {r.deleted_at ? " 🗑" : ""}
                {" · "}
                {r.date}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-cream-100/55">
        <Link href="/admin" className="text-gold-400 underline">← Admin overview</Link>
      </p>
    </div>
  );
}
