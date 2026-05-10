import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format-date";

/**
 * Platform Users table. Joins auth.users (for email + last sign-in) with
 * public.profiles (display name) and surfaces group/round counts per user.
 */
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();

  const sb = supabaseAdmin();

  // Paginate through every auth user — past 200 we used to silently truncate
  // and the search box (client-side) would miss accounts. Cap at 5000 to keep
  // memory bounded.
  const allUsers: Array<any> = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      return <div className="card p-4 text-red-300">Failed to load users: {error.message}</div>;
    }
    if (!data?.users || data.users.length === 0) break;
    allUsers.push(...data.users);
    if (data.users.length < 100) break;
  }

  const userIds = allUsers.map((u) => u.id);

  const [{ data: profiles }, { data: admins }, { data: memberships }, { data: rounds }] = await Promise.all([
    sb.from("profiles").select("id, display_name, created_at").in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("platform_admins").select("profile_id"),
    sb.from("group_members").select("profile_id, group_id, role, groups(name)").in("profile_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("round_players").select("round_id, players!inner(profile_id)").in("players.profile_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"])
  ]);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const adminSet = new Set((admins ?? []).map((a: any) => a.profile_id));
  const groupsByUser = new Map<string, Array<{ id: string; name: string; role: string }>>();
  for (const m of (memberships as any[]) ?? []) {
    const arr = groupsByUser.get(m.profile_id) ?? [];
    arr.push({ id: m.group_id, name: m.groups?.name ?? "(no name)", role: m.role });
    groupsByUser.set(m.profile_id, arr);
  }
  const roundCountByUser = new Map<string, number>();
  for (const r of (rounds as any[]) ?? []) {
    const pid = r.players?.profile_id;
    if (!pid) continue;
    roundCountByUser.set(pid, (roundCountByUser.get(pid) ?? 0) + 1);
  }

  const rows = allUsers
    .map((u) => {
      const p = profileMap.get(u.id) as any;
      return {
        id: u.id,
        email: u.email ?? "",
        display_name: p?.display_name ?? "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        is_admin: adminSet.has(u.id),
        groups: groupsByUser.get(u.id) ?? [],
        round_count: roundCountByUser.get(u.id) ?? 0,
        banned_until: (u as any).banned_until ?? null
      };
    })
    .filter((r) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        r.email.toLowerCase().includes(q) || r.display_name.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Users</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">
            {allUsers.length.toLocaleString()} accounts
          </h1>
        </div>
        <form className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by name or email…"
            className="input text-sm w-64"
          />
          <button className="btn-secondary text-sm" type="submit">Search</button>
        </form>
      </header>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-950/50 text-[10px] uppercase tracking-wider text-cream-100/55">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Groups</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2 text-left">Last sign-in</th>
                <th className="px-3 py-2 text-left">Joined</th>
                <th className="px-3 py-2 text-left">Roles</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-cream-100/8 hover:bg-brand-900/30">
                  <td className="px-3 py-2 text-cream-50 font-medium">
                    {r.display_name || <span className="text-cream-100/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-cream-100/85 break-all">{r.email}</td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs">
                    {r.groups.length === 0 ? (
                      <span className="text-cream-100/40">—</span>
                    ) : (
                      r.groups.map((g) => `${g.name} (${g.role})`).join(", ")
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-cream-100/85">
                    {r.round_count}
                  </td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs tabular-nums">
                    {r.last_sign_in_at ? formatDate(r.last_sign_in_at) : "never"}
                  </td>
                  <td className="px-3 py-2 text-cream-100/65 text-xs tabular-nums">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.is_admin && (
                      <span className="pill bg-gold-500 text-brand-900 text-[10px] px-2 py-0.5 mr-1">
                        Platform Admin
                      </span>
                    )}
                    {r.banned_until && new Date(r.banned_until) > new Date() && (
                      <span className="pill bg-red-200 text-red-900 text-[10px] px-2 py-0.5 mr-1">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/users/${r.id}`} className="text-xs text-gold-400 underline">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-cream-100/55 text-sm">
                    No users {query ? `matching "${query}"` : "yet"}.
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
